// POST /admin — y hệt /api/admin.js cũ (ghi 1 key/value vào site_data, cần adminEmail/adminPass).
'use strict';
const express = require('express');
const { getSql, ensureAllTables } = require('../lib/db');

const router = express.Router();

router.post('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const body = req.body || {};
  const { adminEmail, adminPass, key, value, action } = body;

  if (
    !adminEmail || !adminPass ||
    adminEmail !== process.env.ADMIN_EMAIL ||
    adminPass !== process.env.ADMIN_PASS
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!key) return res.status(400).json({ error: 'key is required' });

  try {
    await ensureAllTables();

    if (action === 'delete') {
      await sql`DELETE FROM site_data WHERE key = ${key}`;
      return res.json({ success: true, action: 'deleted', key });
    }

    const jsonValue = typeof value === 'string' ? value : JSON.stringify(value);
    await sql`
      INSERT INTO site_data (key, value, updated_at)
      VALUES (${key}, ${jsonValue}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE
        SET value = ${jsonValue}::jsonb, updated_at = NOW()
    `;
    return res.json({ success: true, action: 'saved', key });
  } catch (err) {
    console.error('[admin]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
