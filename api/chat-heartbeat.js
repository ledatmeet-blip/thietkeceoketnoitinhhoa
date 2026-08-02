const postgres = require('postgres');

let _sql = null;
function getSql() {
  const connStr = process.env.SUPABASE_DATABASE_URL;
  if (!connStr) return null;
  if (!_sql) _sql = postgres(connStr, { ssl: 'require', prepare: false });
  return _sql;
}

// Client gọi định kỳ (~20s) trong lúc còn mở web/khung chat — "online" = có nhịp tim trong
// 45 giây gần nhất (xem chat-presence.js). Không dùng WebSocket thật để tránh phải dựng thêm
// hạ tầng realtime/RLS phức tạp — đủ dùng cho quy mô cộng đồng CLB.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });

  try {
    await sql`CREATE TABLE IF NOT EXISTS chat_presence (email TEXT PRIMARY KEY, last_seen TIMESTAMPTZ DEFAULT NOW())`;
    const e = email.trim().toLowerCase();
    await sql`INSERT INTO chat_presence (email,last_seen) VALUES (${e},NOW()) ON CONFLICT (email) DO UPDATE SET last_seen=NOW()`;
    return res.json({ success: true });
  } catch (err) {
    console.error('[chat-heartbeat]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
