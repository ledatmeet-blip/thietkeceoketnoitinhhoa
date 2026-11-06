// Gửi tin Telegram dùng chung — giống hệt logic lặp lại ở nhiều file api/*.js cũ, gộp 1 chỗ.
'use strict';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_CHAT_ID || '')
  .split(',').map(s => s.trim()).filter(Boolean);

async function tgNotifyAll(text, extra = {}) {
  if (!BOT_TOKEN || !ADMIN_IDS.length) return [];
  return Promise.all(ADMIN_IDS.map(chatId =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra }),
    }).then(r => r.json()).catch(() => ({ ok: false }))
  ));
}

module.exports = { BOT_TOKEN, ADMIN_IDS, tgNotifyAll };
