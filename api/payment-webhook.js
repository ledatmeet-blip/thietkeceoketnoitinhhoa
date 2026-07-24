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

  // Tìm mã tham chiếu dạng CEO/MEM/WSP + 6 ký tự chữ-số trong nội dung chuyển khoản
  const m = content.match(/\b(CEO|MEM|WSP)[A-Z0-9]{6}\b/);
  if (!m) {
    return res.json({ success: true, skipped: 'no_ref_found' });
  }
  const ref = m[0];

  try {
    const rows = await sql`SELECT * FROM payments WHERE ref = ${ref}`;
    if (!rows.length) return res.json({ success: true, skipped: 'ref_not_found' });
    const pay = rows[0];
    if (pay.status !== 'pending') return res.json({ success: true, skipped: 'already_' + pay.status });

    const amountOk = amount >= parseFloat(pay.amount);
    const code = genCode(pay.type);

    await sql`
      UPDATE payments
      SET status = 'confirmed', code = ${code}, matched_tx = ${JSON.stringify(body)}::jsonb, confirmed_at = NOW()
      WHERE ref = ${ref}
    `;
    await confirmLeadServerSide(sql, pay.lead_id);

    const warn = amountOk ? '' : `\n⚠️ Số tiền chuyển (${amount.toLocaleString('vi-VN')}đ) khác số tiền yêu cầu (${parseFloat(pay.amount).toLocaleString('vi-VN')}đ) — vui lòng kiểm tra lại.`;
    await tgNotifyAll(
      `✅ *THANH TOÁN ĐÃ XÁC NHẬN (SePay)*\n` +
      `📦 ${pay.item_label || pay.type}\n` +
      `🔖 Mã: ${ref}\n` +
      `💰 Số tiền nhận: ${amount.toLocaleString('vi-VN')}đ${warn}\n` +
      `🔑 Mã kích hoạt: ${code}`
    );

    return res.json({ success: true, ref, matched: true });
  } catch (err) {
    console.error('[payment-webhook]', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
