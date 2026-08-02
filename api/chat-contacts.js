const postgres = require('postgres');

let _sql = null;
function getSql() {
  const connStr = process.env.SUPABASE_DATABASE_URL;
  if (!connStr) return null;
  if (!_sql) _sql = postgres(connStr, { ssl: 'require', prepare: false });
  return _sql;
}

async function ensureTable(sql) {
  await sql`CREATE TABLE IF NOT EXISTS chat_contacts (
    id BIGSERIAL PRIMARY KEY,
    requester_email TEXT NOT NULL,
    target_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(requester_email, target_email)
  )`;
}

// action: 'request' | 'accept' | 'reject' | 'remove' | 'list'
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const { action, email, targetEmail, requestId } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action required' });

  try {
    await ensureTable(sql);

    if (action === 'request') {
      if (!email || !targetEmail) return res.status(400).json({ error: 'email, targetEmail required' });
      const e = email.trim().toLowerCase(), t = targetEmail.trim().toLowerCase();
      if (e === t) return res.status(400).json({ error: 'cannot add yourself' });
      // Nếu bên kia đã gửi lời mời cho mình trước đó -> tự động chấp nhận luôn thay vì tạo 2 dòng chờ nhau.
      const reverse = await sql`SELECT * FROM chat_contacts WHERE requester_email=${t} AND target_email=${e}`;
      if (reverse.length) {
        await sql`UPDATE chat_contacts SET status='accepted' WHERE id=${reverse[0].id}`;
        return res.json({ success: true, autoAccepted: true });
      }
      await sql`INSERT INTO chat_contacts (requester_email,target_email,status) VALUES (${e},${t},'pending') ON CONFLICT (requester_email,target_email) DO NOTHING`;
      return res.json({ success: true });
    }
    if (action === 'accept' || action === 'reject') {
      if (!requestId) return res.status(400).json({ error: 'requestId required' });
      await sql`UPDATE chat_contacts SET status=${action === 'accept' ? 'accepted' : 'rejected'} WHERE id=${requestId}`;
      return res.json({ success: true });
    }
    if (action === 'remove') {
      if (!requestId) return res.status(400).json({ error: 'requestId required' });
      await sql`DELETE FROM chat_contacts WHERE id=${requestId}`;
      return res.json({ success: true });
    }
    if (action === 'list') {
      if (!email) return res.status(400).json({ error: 'email required' });
      const e = email.trim().toLowerCase();
      const accepted = await sql`SELECT * FROM chat_contacts WHERE (requester_email=${e} OR target_email=${e}) AND status='accepted'`;
      const incoming = await sql`SELECT * FROM chat_contacts WHERE target_email=${e} AND status='pending'`;
      const outgoing = await sql`SELECT * FROM chat_contacts WHERE requester_email=${e} AND status='pending'`;
      return res.json({ accepted, incoming, outgoing });
    }
    return res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    console.error('[chat-contacts]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
