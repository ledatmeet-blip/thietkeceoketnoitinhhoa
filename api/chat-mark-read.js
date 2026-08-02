const postgres = require('postgres');

let _sql = null;
function getSql() {
  const connStr = process.env.SUPABASE_DATABASE_URL;
  if (!connStr) return null;
  if (!_sql) _sql = postgres(connStr, { ssl: 'require', prepare: false });
  return _sql;
}

function convKey(a, b) {
  return [String(a).trim().toLowerCase(), String(b).trim().toLowerCase()].sort().join('|');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const { myEmail, otherEmail } = req.body || {};
  if (!myEmail || !otherEmail) return res.status(400).json({ error: 'myEmail, otherEmail required' });

  try {
    const ck = convKey(myEmail, otherEmail);
    await sql`UPDATE chat_messages SET read_at=NOW() WHERE conversation_key=${ck} AND to_email=${myEmail.trim().toLowerCase()} AND read_at IS NULL`;
    return res.json({ success: true });
  } catch (err) {
    console.error('[chat-mark-read]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
