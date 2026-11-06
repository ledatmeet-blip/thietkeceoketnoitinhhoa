// GET /payment-status?ref=... — y hệt /api/payment-status.js cũ.
'use strict';
const express = require('express');
const { getSql } = require('../lib/db');

const router = express.Router();

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
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
});

module.exports = router;
