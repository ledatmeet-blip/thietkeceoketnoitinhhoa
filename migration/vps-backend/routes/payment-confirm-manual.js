// POST /payment-confirm-manual — y hệt /api/payment-confirm-manual.js cũ (admin tự xác nhận
// tay khi khách gõ sai nội dung CK khiến webhook không khớp được).
'use strict';
const express = require('express');
const { getSql, ensureAllTables } = require('../lib/db');
const { tgNotifyAll } = require('../lib/telegram');

const router = express.Router();

function genCode(type) {
  const prefix = { ceo: 'CEO', member: 'MEM', workshop: 'WSP', diamond: 'DIA' }[type] || 'PAY';
  return prefix + String(Math.floor(100000 + Math.random() * 900000));
}

async function confirmLeadServerSide(sql, leadId) {
  if (!leadId) return;
  try {
    const rows = await sql`SELECT value FROM site_data WHERE key = 'all-leads-v1'`;
    if (!rows.length) return;
    const leads = rows[0].value;
    if (!Array.isArray(leads)) return;
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    lead.status = 'confirmed';
    await sql`
      UPDATE site_data SET value = ${JSON.stringify(leads)}::jsonb, updated_at = NOW()
      WHERE key = 'all-leads-v1'
    `;
  } catch (err) {
    console.error('[payment-confirm-manual] confirmLeadServerSide', err.message);
  }
}

router.post('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const sql = getSql();
  if (!sql) return res.status(503).json({ error: 'Database not configured' });

  const { adminEmail, adminPass, ref } = req.body || {};
  if (!adminEmail || !adminPass || adminEmail !== process.env.ADMIN_EMAIL || adminPass !== process.env.ADMIN_PASS) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!ref) return res.status(400).json({ error: 'ref is required' });

  try {
    await ensureAllTables();
    const rows = await sql`SELECT * FROM payments WHERE ref = ${ref}`;
    if (!rows.length) return res.status(404).json({ error: 'Không tìm thấy giao dịch' });
    const pay = rows[0];
    if (pay.status === 'confirmed') return res.json({ success: true, code: pay.code, already: true });

    const code = genCode(pay.type);
    await sql`
      UPDATE payments SET status = 'confirmed', code = ${code}, confirmed_at = NOW()
      WHERE ref = ${ref}
    `;
    await confirmLeadServerSide(sql, pay.lead_id);
    await tgNotifyAll(`✅ *ĐÃ XÁC NHẬN THỦ CÔNG*\n📦 ${pay.item_label || pay.type}\n🔖 Mã: ${ref}\n🔑 Mã kích hoạt: ${code}`);

    return res.json({ success: true, code });
  } catch (err) {
    console.error('[payment-confirm-manual]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
