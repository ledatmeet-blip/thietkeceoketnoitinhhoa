// Kết nối Postgres dùng chung cho mọi route. Trên Supabase bắt buộc ssl:'require' (pgbouncer
// pooled connection); trên VPS với Postgres cài local thì KHÔNG cần SSL — set PGSSL=require
// trong .env nếu sau này đổi sang 1 Postgres managed khác cần SSL trở lại.
'use strict';
const postgres = require('postgres');

let _sql = null;
function getSql() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) return null;
  if (!_sql) {
    _sql = postgres(connStr, {
      ssl: process.env.PGSSL === 'require' ? 'require' : false,
      prepare: false,
    });
  }
  return _sql;
}

let _tablesReady = false;
async function ensureAllTables() {
  if (_tablesReady) return;
  const sql = getSql();
  if (!sql) throw new Error('DATABASE_URL chưa cấu hình');

  await sql`CREATE TABLE IF NOT EXISTS site_data (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS payments (
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
  )`;

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

  await sql`CREATE TABLE IF NOT EXISTS chat_presence (
    email TEXT PRIMARY KEY,
    last_seen TIMESTAMPTZ DEFAULT NOW()
  )`;

  _tablesReady = true;
}

// ── Helper dùng chung cho site_data (thay cho việc gọi HTTP sang /api/read, /api/admin
// như code Vercel cũ — giờ các route cùng chạy 1 process nên gọi hàm trực tiếp, nhanh và
// không phụ thuộc domain nào cả). ──
async function readAllSiteData() {
  const sql = getSql();
  await ensureAllTables();
  const rows = await sql`SELECT key, value FROM site_data ORDER BY updated_at DESC`;
  const result = {};
  rows.forEach(r => { result[r.key] = r.value; });
  return result;
}

async function readSiteDataKey(key) {
  const sql = getSql();
  await ensureAllTables();
  const rows = await sql`SELECT value FROM site_data WHERE key = ${key}`;
  return rows.length ? rows[0].value : undefined;
}

async function writeSiteDataKey(key, value) {
  const sql = getSql();
  await ensureAllTables();
  const jsonValue = typeof value === 'string' ? value : JSON.stringify(value);
  await sql`
    INSERT INTO site_data (key, value, updated_at)
    VALUES (${key}, ${jsonValue}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = ${jsonValue}::jsonb, updated_at = NOW()
  `;
}

module.exports = { getSql, ensureAllTables, readAllSiteData, readSiteDataKey, writeSiteDataKey };
