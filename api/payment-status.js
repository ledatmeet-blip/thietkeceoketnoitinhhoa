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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const { ref } = req.query;
  if (!ref) return res.status(400).json({ error: 'ref is required' });

  try {
    const rows = await sql`SELECT status, code FROM payments WHERE ref = ${ref}`;
    if (!rows.length) return res.status(404).json({ status: 'not_found' });
    const row = rows[0];
    return res.json({
      status: row.status,
      code: row.status === 'confirmed' ? row.code : undefined,
    });
  } catch (err) {
    console.error('[payment-status]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
