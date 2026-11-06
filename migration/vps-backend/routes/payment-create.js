// POST /payment-create — y hệt /api/payment-create.js cũ.
'use strict';
const express = require('express');
const { getSql, ensureAllTables } = require('../lib/db');

const router = express.Router();

const PREFIX = { ceo: 'CEO', member: 'MEM', workshop: 'WSP', diamond: 'DIA', product: 'DH', flipbook: 'FBK' };
const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ ký tự dễ nhầm (0/O, 1/I)

function genRef(type) {
  const prefix = PREFIX[type] || 'PAY';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += ALNUM[Math.floor(Math.random() * ALNUM.length)];
  return prefix + suffix;
}

router.post('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const { type, itemLabel, amount, leadId } = req.body || {};
  if (!type || !PREFIX[type]) return res.status(400).json({ error: 'Invalid type' });
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

  try {
    await ensureAllTables();

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
});

module.exports = router;
