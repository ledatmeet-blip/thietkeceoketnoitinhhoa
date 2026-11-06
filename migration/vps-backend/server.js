// Backend Express duy nhất thay thế toàn bộ api/*.js trên Vercel — chạy trên VPS qua PM2,
// đứng sau Nginx (reverse proxy + SSL). Mỗi route dưới /routes tương ứng 1-1 với 1 file
// api/*.js cũ (xem comment đầu mỗi file route để biết nó thay thế file nào).
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const app = express();

// ── CORS: giữ đúng hành vi cũ (Access-Control-Allow-Origin: *) mặc định; khi đã ổn định,
// nên siết lại bằng cách set ALLOWED_ORIGIN=https://ceoketnoitinhhoa.vn trong .env ──
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

app.use(express.json({ limit: '10mb' }));

// Phục vụ ảnh/video/PDF đã upload trực tiếp từ đĩa (thay cho Supabase Storage public URL)
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
app.use('/uploads', express.static(UPLOAD_DIR));

app.use('/read', require('./routes/read'));
app.use('/admin', require('./routes/admin'));
app.use('/upload', require('./routes/upload'));
app.use('/payment-create', require('./routes/payment-create'));
app.use('/payment-status', require('./routes/payment-status'));
app.use('/payment-webhook', require('./routes/payment-webhook'));
app.use('/payment-confirm-manual', require('./routes/payment-confirm-manual'));
app.use('/chat', require('./routes/chat'));
app.use('/website-chat', require('./routes/website-chat'));
app.use('/telegram', require('./routes/telegram'));
app.use('/telegram-notify', require('./routes/telegram-notify'));

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] Backend đang chạy tại http://localhost:${PORT}`);
});
