const postgres = require('postgres');

let _sql = null;
function getSql() {
  const connStr = process.env.SUPABASE_DATABASE_URL;
  if (!connStr) return null;
  if (!_sql) _sql = postgres(connStr, { ssl: 'require', prepare: false });
  return _sql;
}

// Trả về hội thoại gần nhất (tin cuối) cho từng người đã từng nhắn qua lại với `email`,
// kèm số tin chưa đọc — dùng để dựng danh sách hội thoại (giống tab "Đoạn chat" của Messenger).
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });

  try {
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
    const e = email.trim().toLowerCase();
    const rows = await sql`
      SELECT DISTINCT ON (conversation_key) *
      FROM chat_messages
      WHERE from_email=${e} OR to_email=${e}
      ORDER BY conversation_key, id DESC
    `;
    const unread = await sql`
      SELECT conversation_key, COUNT(*)::int AS cnt FROM chat_messages
      WHERE to_email=${e} AND read_at IS NULL
      GROUP BY conversation_key
    `;
    const unreadMap = {};
    unread.forEach(r => { unreadMap[r.conversation_key] = r.cnt; });
    const conversations = rows.map(r => ({
      ...r,
      otherEmail: r.from_email === e ? r.to_email : r.from_email,
      unread: unreadMap[r.conversation_key] || 0,
    }));
    return res.json({ conversations });
  } catch (err) {
    console.error('[chat-conversations]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
