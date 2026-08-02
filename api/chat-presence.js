const postgres = require('postgres');

let _sql = null;
function getSql() {
  const connStr = process.env.SUPABASE_DATABASE_URL;
  if (!connStr) return null;
  if (!_sql) _sql = postgres(connStr, { ssl: 'require', prepare: false });
  return _sql;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  try {
    await sql`CREATE TABLE IF NOT EXISTS chat_presence (email TEXT PRIMARY KEY, last_seen TIMESTAMPTZ DEFAULT NOW())`;
    const rows = await sql`SELECT email FROM chat_presence WHERE last_seen > NOW() - INTERVAL '45 seconds'`;
    return res.json({ online: rows.map(r => r.email) });
  } catch (err) {
    console.error('[chat-presence]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
