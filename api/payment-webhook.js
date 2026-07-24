const postgres = require('postgres');

let _sql = null;

function getSql() {
  const connStr = process.env.SUPABASE_DATABASE_URL;
  if (!connStr) return null;
  if (!_sql) _sql = postgres(connStr, { ssl: 'require', prepare: false });
  return _sql;
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_CHAT_ID || '')
  .split(',').map(s => s.trim()).filter(Boolean);

async function tgNotifyAll(text) {
  if (!BOT_TOKEN || !ADMIN_IDS.length) return;
  await Promise.all(ADMIN_IDS.map(chatId =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    }).catch(() => {})
  ));
}

function genCode(type) {
  const prefix = { ceo: 'CEO', member: 'MEM', workshop: 'WSP' }[type] || 'PAY';
  return prefix + String(Math.floor(100000 + Math.random() * 900000));
}

// Levenshtein đơn giản — dùng để dung sai 1 ký tự gõ sai/thiếu/thừa khi khách
// chuyển khoản chép tay nội dung (VD: "CEO4HF8G" thay vì "CEOE4HF8G" — thiếu chữ E).
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99; // chênh lệch độ dài quá lớn, chắc chắn không khớp — bỏ qua sớm cho nhanh
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

// Tìm payment "pending" khớp nhất với nội dung chuyển khoản thật (cho phép lệch tối đa 1 ký tự)
function findBestMatch(content, pendingRows) {
  const tokens = content.split(/[^A-Z0-9]+/).filter(t => t.length >= 6 && t.length <= 11);
  let best = null; // { pay, dist }
  for (const row of pendingRows) {
    for (const token of tokens) {
      const dist = editDistance(token, row.ref);
      if (dist <= 1 && (!best || dist < best.dist)) best = { pay: row, dist };
    }
  }
  return best;
}

// Cập nhật trạng thái 1 lead trong bảng site_data (key 'all-leads-v1') — server-side
// tương đương _updateLeadStatus() phía client, để lead cũng phản ánh đúng khi xác nhận qua webhook.
async function confirmLeadServerSide(sql, leadId) {
  if (!leadId) return;
  try {
    const rows = await sql`SELECT value FROM site_data WHERE key = 'all-leads-v1'`;
    if (!rows.length) return;
    const leads = rows[0].value;
    if (!Array.isArray(leads)) return;
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    lead.status = 'confirmed';
    await sql`
      UPDATE site_data SET value = ${JSON.stringify(leads)}::jsonb, updated_at = NOW()
      WHERE key = 'all-leads-v1'
    `;
  } catch (err) {
    console.error('[payment-webhook] confirmLeadServerSide', err.message);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Xác thực: SePay gửi header "Authorization: Apikey <SEPAY_WEBHOOK_KEY>"
  const auth = req.headers['authorization'] || '';
  const expected = process.env.SEPAY_WEBHOOK_KEY;
  if (!expected || auth !== `Apikey ${expected}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const sql = getSql();
  if (!sql) return res.status(503).json({ success: false, error: 'Database not configured' });

  const body = req.body || {};
  // Chỉ xử lý tiền VÀO tài khoản
  if (body.transferType && body.transferType !== 'in') {
    return res.json({ success: true, skipped: 'not_incoming' });
  }

  const content = String(body.content || body.description || '').toUpperCase();
  const amount = parseFloat(body.transferAmount) || 0;

  try {
    const pendingRows = await sql`SELECT * FROM payments WHERE status = 'pending' ORDER BY created_at DESC`;
    if (!pendingRows.length) return res.json({ success: true, skipped: 'no_pending' });

    const match = findBestMatch(content, pendingRows);
    if (!match) return res.json({ success: true, skipped: 'no_ref_found' });
    const pay = match.pay;
    const ref = pay.ref;

    const amountOk = amount >= parseFloat(pay.amount);
    const code = genCode(pay.type);

    await sql`
      UPDATE payments
      SET status = 'confirmed', code = ${code}, matched_tx = ${JSON.stringify(body)}::jsonb, confirmed_at = NOW()
      WHERE ref = ${ref}
    `;
    await confirmLeadServerSide(sql, pay.lead_id);

    const fuzzyNote = match.dist > 0 ? `\nℹ️ Khớp gần đúng (lệch ${match.dist} ký tự so với nội dung CK thực nhận).` : '';
    const warn = amountOk ? '' : `\n⚠️ Số tiền chuyển (${amount.toLocaleString('vi-VN')}đ) khác số tiền yêu cầu (${parseFloat(pay.amount).toLocaleString('vi-VN')}đ) — vui lòng kiểm tra lại.`;
    await tgNotifyAll(
      `✅ *THANH TOÁN ĐÃ XÁC NHẬN (SePay)*\n` +
      `📦 ${pay.item_label || pay.type}\n` +
      `🔖 Mã: ${ref}\n` +
      `💰 Số tiền nhận: ${amount.toLocaleString('vi-VN')}đ${warn}${fuzzyNote}\n` +
      `🔑 Mã kích hoạt: ${code}`
    );

    return res.json({ success: true, ref, matched: true, editDistance: match.dist });
  } catch (err) {
    console.error('[payment-webhook]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
