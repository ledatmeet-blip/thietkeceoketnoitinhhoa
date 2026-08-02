// Community chat — mọi thao tác chat (gửi tin, lịch sử, hội thoại, đánh dấu đã đọc, kết
// nối/kết bạn, nhịp tim online, danh sách online) gộp vào 1 function duy nhất, dispatch theo
// req.body.op — Vercel Hobby plan giới hạn tối đa 12 Serverless Functions/deployment nên không
// tách file riêng như ban đầu dự định.
const postgres = require('postgres');

let _sql = null;
function getSql() {
  const connStr = process.env.SUPABASE_DATABASE_URL;
  if (!connStr) return null;
  if (!_sql) _sql = postgres(connStr, { ssl: 'require', prepare: false });
  return _sql;
}

let _tablesReady = false;
async function ensureTables(sql) {
  if (_tablesReady) return;
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
  await sql`CREATE TABLE IF NOT EXISTS chat_contacts (
    id BIGSERIAL PRIMARY KEY,
    requester_email TEXT NOT NULL,
    target_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(requester_email, target_email)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS chat_presence (email TEXT PRIMARY KEY, last_seen TIMESTAMPTZ DEFAULT NOW())`;
  _tablesReady = true;
}

function convKey(a, b) {
  return [String(a).trim().toLowerCase(), String(b).trim().toLowerCase()].sort().join('|');
}
function norm(e) { return String(e || '').trim().toLowerCase(); }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const body = req.body || {};
  const op = body.op;
  if (!op) return res.status(400).json({ error: 'op required' });

  try {
    await ensureTables(sql);

    if (op === 'send') {
      const { fromEmail, toEmail, type, content, durationSec, replyToId } = body;
      if (!fromEmail || !toEmail || !content) return res.status(400).json({ error: 'fromEmail, toEmail, content required' });
      if (String(content).length > 8000) return res.status(400).json({ error: 'content too long' });
      if (norm(fromEmail) === norm(toEmail)) return res.status(400).json({ error: 'cannot message yourself' });
      const ck = convKey(fromEmail, toEmail);
      const rows = await sql`
        INSERT INTO chat_messages (conversation_key, from_email, to_email, type, content, duration_sec, reply_to_id)
        VALUES (${ck}, ${norm(fromEmail)}, ${norm(toEmail)}, ${type || 'text'}, ${content}, ${durationSec || null}, ${replyToId || null})
        RETURNING *`;
      return res.json({ success: true, message: rows[0] });
    }

    if (op === 'history') {
      const { email1, email2, sinceId, beforeId } = body;
      if (!email1 || !email2) return res.status(400).json({ error: 'email1, email2 required' });
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
    }

    if (op === 'conversations') {
      const { email } = body;
      if (!email) return res.status(400).json({ error: 'email required' });
      const e = norm(email);
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
    }

    if (op === 'markRead') {
      const { myEmail, otherEmail } = body;
      if (!myEmail || !otherEmail) return res.status(400).json({ error: 'myEmail, otherEmail required' });
      const ck = convKey(myEmail, otherEmail);
      await sql`UPDATE chat_messages SET read_at=NOW() WHERE conversation_key=${ck} AND to_email=${norm(myEmail)} AND read_at IS NULL`;
      return res.json({ success: true });
    }

    if (op === 'contactRequest') {
      const { email, targetEmail } = body;
      if (!email || !targetEmail) return res.status(400).json({ error: 'email, targetEmail required' });
      const e = norm(email), t = norm(targetEmail);
      if (e === t) return res.status(400).json({ error: 'cannot add yourself' });
      const reverse = await sql`SELECT * FROM chat_contacts WHERE requester_email=${t} AND target_email=${e}`;
      if (reverse.length) {
        await sql`UPDATE chat_contacts SET status='accepted' WHERE id=${reverse[0].id}`;
        return res.json({ success: true, autoAccepted: true });
      }
      await sql`INSERT INTO chat_contacts (requester_email,target_email,status) VALUES (${e},${t},'pending') ON CONFLICT (requester_email,target_email) DO NOTHING`;
      return res.json({ success: true });
    }

    if (op === 'contactAccept' || op === 'contactReject') {
      const { requestId } = body;
      if (!requestId) return res.status(400).json({ error: 'requestId required' });
      await sql`UPDATE chat_contacts SET status=${op === 'contactAccept' ? 'accepted' : 'rejected'} WHERE id=${requestId}`;
      return res.json({ success: true });
    }

    if (op === 'contactList') {
      const { email } = body;
      if (!email) return res.status(400).json({ error: 'email required' });
      const e = norm(email);
      const accepted = await sql`SELECT * FROM chat_contacts WHERE (requester_email=${e} OR target_email=${e}) AND status='accepted'`;
      const incoming = await sql`SELECT * FROM chat_contacts WHERE target_email=${e} AND status='pending'`;
      const outgoing = await sql`SELECT * FROM chat_contacts WHERE requester_email=${e} AND status='pending'`;
      return res.json({ accepted, incoming, outgoing });
    }

    if (op === 'heartbeat') {
      const { email } = body;
      if (!email) return res.status(400).json({ error: 'email required' });
      await sql`INSERT INTO chat_presence (email,last_seen) VALUES (${norm(email)},NOW()) ON CONFLICT (email) DO UPDATE SET last_seen=NOW()`;
      return res.json({ success: true });
    }

    if (op === 'presence') {
      const rows = await sql`SELECT email FROM chat_presence WHERE last_seen > NOW() - INTERVAL '45 seconds'`;
      return res.json({ online: rows.map(r => r.email) });
    }

    return res.status(400).json({ error: 'unknown op: ' + op });
  } catch (err) {
    console.error('[chat:' + op + ']', err.message);
    return res.status(500).json({ error: err.message });
  }
};
