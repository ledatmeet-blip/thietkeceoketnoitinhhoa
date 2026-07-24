const postgres = require('postgres');

let _sql = null;
let _tableReady = false;

function getSql() {
  const connStr = process.env.SUPABASE_DATABASE_URL;
  if (!connStr) return null;
  if (!_sql) _sql = postgres(connStr, { ssl: 'require', prepare: false });
  return _sql;
}

async function ensureTable(sql) {
  if (_tableReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS payments (
      ref          TEXT PRIMARY KEY,
      type         TEXT NOT NULL,
      item_label   TEXT,
      amount       NUMERIC NOT NULL,
      lead_id      TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      code         TEXT,
      matched_tx   JSONB,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      confirmed_at TIMESTAMPTZ
    )
  `;
  _tableReady = true;
}

const PREFIX = { ceo: 'CEO', member: 'MEM', workshop: 'WSP' };
const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ ký tự dễ nhầm (0/O, 1/I)

function genRef(type) {
  const prefix = PREFIX[type] || 'PAY';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += ALNUM[Math.floor(Math.random() * ALNUM.length)];
  return prefix + suffix;
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

  const { type, itemLabel, amount, leadId } = req.body || {};
  if (!type || !PREFIX[type]) return res.status(400).json({ error: 'Invalid type' });
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

  try {
    await ensureTable(sql);

    let ref;
    for (let attempt = 0; attempt < 5; attempt++) {
      ref = genRef(type);
      const existing = await sql`SELECT ref FROM payments WHERE ref = ${ref}`;
      if (!existing.length) break;
      ref = null;
    }
    if (!ref) return res.status(500).json({ error: 'Could not generate unique ref' });

    await sql`
      INSERT INTO payments (ref, type, item_label, amount, lead_id, status)
      VALUES (${ref}, ${type}, ${itemLabel || ''}, ${amt}, ${leadId || null}, 'pending')
    `;

    return res.json({ ref });
  } catch (err) {
    console.error('[payment-create]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
