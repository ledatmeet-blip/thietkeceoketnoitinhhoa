// Cổng vào GET /read — y hệt /api/read.js cũ, chỉ đổi sang Express.
'use strict';
const express = require('express');
const { readAllSiteData, readSiteDataKey } = require('../lib/db');

const router = express.Router();

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { key } = req.query;
    if (key) {
      const value = await readSiteDataKey(key);
      if (value === undefined) return res.status(404).json({ error: 'Not found' });
      return res.json({ value });
    }
    const result = await readAllSiteData();
    return res.json(result);
  } catch (err) {
    console.error('[read]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
