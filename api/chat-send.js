const postgres = require('postgres');

let _sql = null;
function getSql() {
  const connStr = process.env.SUPABASE_DATABASE_URL;
  if (!connStr) return null;
  if (!_sql) _sql = postgres(connStr, { ssl: 'require', prepare: false });
  return _sql;
}

async function ensureTables(sql) {
  await sql`CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_key TEXT NOT NULL,
    from_email TEXT NOT NULL,
    to_email TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    content TEXT,
    duration_sec INT,
    reply_to_id BIGINT,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_chat_conv ON chat_messages(conversation_key, id)`;
}

function convKey(a, b) {
  return [String(a).trim().toLowerCase(), String(b).trim().toLowerCase()].sort().join('|');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const { fromEmail, toEmail, type, content, durationSec, replyToId } = req.body || {};
  if (!fromEmail || !toEmail || !content) return res.status(400).json({ error: 'fromEmail, toEmail, content required' });
  if (String(content).length > 8000) return res.status(400).json({ error: 'content too long' });
  if (fromEmail.trim().toLowerCase() === toEmail.trim().toLowerCase()) return res.status(400).json({ error: 'cannot message yourself' });

  try {
    await ensureTables(sql);
    const ck = convKey(fromEmail, toEmail);
    const rows = await sql`
      INSERT INTO chat_messages (conversation_key, from_email, to_email, type, content, duration_sec, reply_to_id)
      VALUES (${ck}, ${fromEmail.trim().toLowerCase()}, ${toEmail.trim().toLowerCase()}, ${type || 'text'}, ${content}, ${durationSec || null}, ${replyToId || null})
      RETURNING *`;
    return res.json({ success: true, message: rows[0] });
  } catch (err) {
    console.error('[chat-send]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
