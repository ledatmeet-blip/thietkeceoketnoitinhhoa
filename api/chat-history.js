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
}

function convKey(a, b) {
  return [String(a).trim().toLowerCase(), String(b).trim().toLowerCase()].sort().join('|');
}

// sinceId: chỉ lấy tin nhắn MỚI hơn (dùng để poll định kỳ, tránh tải lại toàn bộ lịch sử).
// Không có sinceId: lấy 50 tin gần nhất (mở hội thoại lần đầu).
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const { email1, email2, sinceId, beforeId } = req.body || {};
  if (!email1 || !email2) return res.status(400).json({ error: 'email1, email2 required' });

  try {
    await ensureTables(sql);
    const ck = convKey(email1, email2);
    let rows;
    if (sinceId) {
      rows = await sql`SELECT * FROM chat_messages WHERE conversation_key=${ck} AND id > ${sinceId} ORDER BY id ASC LIMIT 200`;
    } else if (beforeId) {
      rows = (await sql`SELECT * FROM chat_messages WHERE conversation_key=${ck} AND id < ${beforeId} ORDER BY id DESC LIMIT 50`).reverse();
    } else {
      rows = (await sql`SELECT * FROM chat_messages WHERE conversation_key=${ck} ORDER BY id DESC LIMIT 50`).reverse();
    }
    return res.json({ messages: rows });
  } catch (err) {
    console.error('[chat-history]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
