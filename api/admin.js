const { neon } = require('@neondatabase/serverless');

let _sql = null;
let _tableReady = false;

function getSql() {
  if (!process.env.DATABASE_URL) return null;
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

async function ensureTable(sql) {
  if (_tableReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS site_data (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  _tableReady = true;
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

  const body = req.body || {};
  const { adminEmail, adminPass, key, value, action } = body;

  if (
    !adminEmail || !adminPass ||
    adminEmail !== process.env.ADMIN_EMAIL ||
    adminPass  !== process.env.ADMIN_PASS
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!key) return res.status(400).json({ error: 'key is required' });

  try {
    await ensureTable(sql);

    if (action === 'delete') {
      await sql`DELETE FROM site_data WHERE key = ${key}`;
      return res.json({ success: true, action: 'deleted', key });
    }

    // Normalize value: Neon expects a JS value for JSONB, not a JSON string
    const jsonValue = typeof value === 'string' ? value : JSON.stringify(value);

    await sql`
      INSERT INTO site_data (key, value, updated_at)
      VALUES (${key}, ${jsonValue}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE
        SET value      = ${jsonValue}::jsonb,
            updated_at = NOW()
    `;

    return res.json({ success: true, action: 'saved', key });
  } catch (err) {
    console.error('[admin]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
