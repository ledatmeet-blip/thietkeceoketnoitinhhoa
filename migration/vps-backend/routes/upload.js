// POST /upload — THAY THẾ /api/upload-url.js (signed URL lên Supabase Storage).
//
// Lý do đổi: /api/upload-url.js cũ tồn tại CHỈ để né giới hạn 4.5MB của Vercel serverless
// function (xem comment gốc trong file đó) — trình duyệt phải xin signed URL rồi tự PUT
// thẳng lên Supabase Storage, không qua server. Trên VPS không có giới hạn đó, nên đơn giản
// hoá: trình duyệt upload thẳng file (multipart) vào endpoint này, server lưu vào đĩa, trả về
// publicUrl phục vụ qua Nginx/Express static — không cần Supabase Storage/MinIO nữa.
//
// ĐÂY LÀ THAY ĐỔI CẦN SỬA index.html TƯƠNG ỨNG (xem migration/vps-backend/CLIENT-PATCH.md) —
// đừng deploy phần server này mà chưa đổi code client, upload sẽ không hoạt động.
'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(), // nhận vào RAM trước, tự đặt tên file sau khi xác thực xong
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB — thoải mái cho video sách lật, ảnh, PDF
});

function cleanName(name) {
  return String(name).replace(/[^a-z0-9.\-_]/gi, '-').slice(0, 100);
}

router.post('/', upload.single('file'), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { adminEmail, adminPass, filename } = req.body || {};
  if (
    !adminEmail || !adminPass ||
    adminEmail !== process.env.ADMIN_EMAIL ||
    adminPass !== process.env.ADMIN_PASS
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!req.file) return res.status(400).json({ error: 'file is required (multipart field "file")' });

  try {
    const name = cleanName(filename || req.file.originalname || `upload-${Date.now()}`);
    const destPath = path.join(UPLOAD_DIR, name);
    fs.writeFileSync(destPath, req.file.buffer);

    const base = process.env.PUBLIC_UPLOAD_BASE_URL || '/uploads';
    const publicUrl = `${base.replace(/\/$/, '')}/${name}`;

    return res.json({ path: name, publicUrl });
  } catch (err) {
    console.error('[upload]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
