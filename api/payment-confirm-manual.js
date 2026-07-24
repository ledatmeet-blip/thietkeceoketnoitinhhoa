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
    console.error('[payment-confirm-manual] confirmLeadServerSide', err.message);
  }
}

// Dự phòng: admin tự tra thấy giao dịch trong app ngân hàng rồi xác nhận thủ công qua
// đây (ví dụ khách gõ sai nội dung CK khiến webhook không khớp được). Mã kích hoạt sẽ
// được sinh ra và báo cho admin qua Telegram để gửi lại cho khách.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const { adminEmail, adminPass, ref } = req.body || {};
  if (!adminEmail || !adminPass || adminEmail !== process.env.ADMIN_EMAIL || adminPass !== process.env.ADMIN_PASS) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!ref) return res.status(400).json({ error: 'ref is required' });

  try {
    const rows = await sql`SELECT * FROM payments WHERE ref = ${ref}`;
    if (!rows.length) return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
    const pay = rows[0];
    if (pay.status === 'confirmed') return res.json({ success: true, code: pay.code, already: true });

    const code = genCode(pay.type);
    await sql`
      UPDATE payments SET status = 'confirmed', code = ${code}, confirmed_at = NOW()
      WHERE ref = ${ref}
    `;
    await confirmLeadServerSide(sql, pay.lead_id);
    await tgNotifyAll(`✅ *ĐÃ XÁC NHẬN THỦ CÔNG*\n📦 ${pay.item_label || pay.type}\n🔖 Mã: ${ref}\n🔑 Mã kích hoạt: ${code}`);

    return res.json({ success: true, code });
  } catch (err) {
    console.error('[payment-confirm-manual]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
