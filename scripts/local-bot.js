#!/usr/bin/env node
/**
 * LOCAL BOT — polling mode
 * Chạy trên Mac, nhận lệnh từ Telegram, làm việc trực tiếp với project localhost:8899
 * Khởi động: node scripts/local-bot.js
 */

const { execSync, exec } = require('child_process');
const fs   = require('fs');
const path = require('path');
const https = require('https');

// ── Load .env.local ─────────────────────────────────────────────────────────
const envFile = path.join(__dirname, '../.env.local');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  });
}

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID    = process.env.TELEGRAM_ADMIN_CHAT_ID;
const GROQ_KEY    = process.env.GROQ_API_KEY;
const PROJECT_DIR = process.env.PROJECT_DIR || path.join(__dirname, '..');

if (!BOT_TOKEN) { console.error('❌ Thiếu TELEGRAM_BOT_TOKEN'); process.exit(1); }

// ── Groq AI (Llama 3.3 70B — free, nhanh, hiểu tiếng Việt tốt) ──────────────
const SYSTEM_TEXT = `Bạn là trợ lý AI đang chạy TRỰC TIẾP trên máy Mac của Lê Đạt.
Bạn có khả năng đọc file, chạy lệnh terminal, và làm việc với project CEO Kết Nối Tinh Hoa tại localhost:8899.

Project: /Users/leminhchau/Desktop/thietkeceoketnoitinhhoa/index.html (~5500 dòng)
Tech: Single-file HTML/CSS/JS, Neon PostgreSQL, Vercel Blob, Vercel Edge Functions
Dev server: python3 -m http.server 8899 (chạy tại thư mục project)
Live: https://thietkeceoketnoitinhhoa.vercel.app

Khi được hỏi về code hoặc file → đọc file thật rồi trả lời chính xác.
Khi Đạt hỏi về lệnh → đưa ra lệnh cụ thể, ngắn gọn.
Khi Đạt gặp bug → phân tích và đưa ra hướng fix.

Phong cách: thẳng thắn, vui vẻ, ngắn gọn. Như đồng nghiệp thân đang ngồi cạnh.`;

const _history = [];
const MAX_HIST = 16;

async function askAI(userText, contextInfo = '') {
  const content = contextInfo ? `${userText}\n\n[Context từ máy local]\n${contextInfo}` : userText;
  _history.push({ role: 'user', content });
  if (_history.length > MAX_HIST) _history.splice(0, _history.length - MAX_HIST);

  const body = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: SYSTEM_TEXT }, ..._history],
    temperature: 0.8,
    max_tokens: 900,
  });

  return new Promise((resolve) => {
    const req = https.request('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`,
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const reply  = parsed.choices?.[0]?.message?.content || '🤔 Không có phản hồi';
          _history.push({ role: 'assistant', content: reply });
          resolve(reply);
        } catch { resolve('⚡ Lỗi parse response'); }
      });
    });
    req.on('error', () => resolve('⚡ Không kết nối được AI'));
    req.write(body);
    req.end();
  });
}

// ── Telegram helpers ─────────────────────────────────────────────────────────
function tgRequest(method, data) {
  return new Promise((resolve) => {
    const body = JSON.stringify(data);
    const req  = https.request(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d || '{}'))) }
    );
    req.on('error', () => resolve({}));
    req.write(body);
    req.end();
  });
}

async function send(chatId, text) {
  // Tách tin dài
  const chunks = [];
  while (text.length > 3800) {
    let cut = text.lastIndexOf('\n', 3800);
    if (cut < 1000) cut = 3800;
    chunks.push(text.slice(0, cut));
    text = text.slice(cut).trim();
  }
  if (text) chunks.push(text);
  for (const chunk of chunks) {
    await tgRequest('sendMessage', { chat_id: chatId, text: chunk, parse_mode: 'Markdown' });
  }
}

async function typing(chatId) {
  await tgRequest('sendChatAction', { chat_id: chatId, action: 'typing' });
}

// ── Local shell (an toàn) ────────────────────────────────────────────────────
function shell(cmd, cwd = PROJECT_DIR) {
  try {
    return execSync(cmd, { cwd, timeout: 15000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return e.stderr?.trim() || e.message?.slice(0, 500) || 'Lỗi không xác định';
  }
}

function isServerRunning() {
  try {
    execSync(`lsof -i :8899 -t`, { timeout: 3000 });
    return true;
  } catch { return false; }
}

// ── Commands ─────────────────────────────────────────────────────────────────
async function handleCommand(chatId, text) {
  const cmd = text.trim().toLowerCase();

  // /start
  if (cmd === '/start') {
    const running = isServerRunning();
    await send(chatId,
      `🖥️ *Local Bot — CEO Kết Nối Tinh Hoa*\n\n` +
      `Server: ${running ? '✅ localhost:8899 đang chạy' : '❌ Server chưa chạy'}\n\n` +
      `*Lệnh nhanh:*\n` +
      `/run — khởi động dev server\n` +
      `/stop — dừng server\n` +
      `/status — xem trạng thái\n` +
      `/git — git status + log gần nhất\n` +
      `/lines — đếm dòng code\n` +
      `/clear — reset conversation\n\n` +
      `Hoặc chat tự nhiên — tôi đọc được code project của bạn! 💬`
    );
    return;
  }

  // /status
  if (cmd === '/status' || cmd === '/s') {
    const running = isServerRunning();
    const pid     = running ? shell('lsof -i :8899 -t') : '—';
    const lines   = shell(`wc -l index.html | awk '{print $1}'`);
    const gitLog  = shell('git log --oneline -3');
    await send(chatId,
      `📊 *Project Status*\n\n` +
      `🔵 Server: ${running ? `✅ Chạy (PID: ${pid})` : '❌ Không chạy'}\n` +
      `🌐 Local: http://localhost:8899\n` +
      `📄 index.html: *${lines} dòng*\n\n` +
      `*Git log gần nhất:*\n\`\`\`\n${gitLog}\n\`\`\``
    );
    return;
  }

  // /run — khởi động server
  if (cmd === '/run' || cmd === '/start-server') {
    if (isServerRunning()) {
      await send(chatId, '✅ Server đang chạy rồi!\nMở: http://localhost:8899');
      return;
    }
    exec(`python3 -m http.server 8899`, { cwd: PROJECT_DIR, detached: true, stdio: 'ignore' }).unref();
    await new Promise(r => setTimeout(r, 1500));
    const ok = isServerRunning();
    await send(chatId, ok
      ? '✅ Server đã khởi động!\n🌐 http://localhost:8899'
      : '❌ Không khởi động được server. Thử lại hoặc chạy thủ công.'
    );
    return;
  }

  // /stop
  if (cmd === '/stop') {
    if (!isServerRunning()) { await send(chatId, 'ℹ️ Server không chạy.'); return; }
    shell('lsof -ti:8899 | xargs kill -9 2>/dev/null; true');
    await send(chatId, '🛑 Đã dừng server localhost:8899');
    return;
  }

  // /git
  if (cmd === '/git') {
    const status = shell('git status --short');
    const log    = shell('git log --oneline -5');
    await send(chatId,
      `*Git Status:*\n\`\`\`\n${status || '(sạch)'}\n\`\`\`\n\n*Log gần nhất:*\n\`\`\`\n${log}\n\`\`\``
    );
    return;
  }

  // /lines
  if (cmd === '/lines') {
    const total   = shell(`wc -l index.html | awk '{print $1}'`);
    const cssCnt  = shell(`grep -c '<style\\|{' index.html || true`);
    const jsFuncs = shell(`grep -c 'function ' index.html || true`);
    await send(chatId,
      `📄 *index.html stats:*\n\n` +
      `Tổng dòng: *${total}*\n` +
      `Số hàm JS: ~${jsFuncs}\n`
    );
    return;
  }

  // /clear
  if (cmd === '/clear') {
    _history.splice(0);
    await send(chatId, '🧹 Reset xong! Bắt đầu mới nào 🚀');
    return;
  }

  // /deploy
  if (cmd === '/deploy') {
    await send(chatId, '🚀 Đang deploy lên Vercel...');
    exec('env -u ELECTRON_RUN_AS_NODE vercel deploy --prod', { cwd: PROJECT_DIR }, async (err, stdout) => {
      const result = stdout?.match(/https:\/\/[^\s]+\.vercel\.app/)?.[0] || (err ? 'Lỗi deploy' : 'Xong');
      await send(chatId, err ? `❌ Deploy lỗi: ${err.message?.slice(0, 200)}` : `✅ Deployed!\n${result}`);
    });
    return;
  }

  return null; // không phải command → AI chat
}

// ── Polling loop ──────────────────────────────────────────────────────────────
let offset = 0;

async function poll() {
  try {
    const res = await tgRequest('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
    if (!res.ok || !res.result?.length) return;

    for (const update of res.result) {
      offset = update.update_id + 1;
      const msg    = update.message;
      if (!msg?.text) continue;

      const chatId = String(msg.chat.id);
      const text   = msg.text.trim();

      // Security
      if (ADMIN_ID && chatId !== String(ADMIN_ID)) {
        await send(chatId, '🔒 Chỉ admin mới dùng được bot này.');
        continue;
      }

      console.log(`[${new Date().toLocaleTimeString('vi-VN')}] ${text.slice(0, 80)}`);

      // Thử xử lý như command
      const handled = await handleCommand(chatId, text);
      if (handled !== null) continue;

      // AI Chat với context local
      await typing(chatId);
      let context = '';
      // Nếu hỏi về code/tính năng → đưa thêm context file size
      if (/code|function|css|js|html|dòng|sửa|bug|lỗi|tính năng/i.test(text)) {
        const lines = shell(`wc -l index.html | awk '{print $1}'`);
        const git   = shell('git log --oneline -2');
        context = `File index.html hiện có ${lines} dòng.\nGit log: ${git}`;
      }

      const reply = await askAI(text, context);
      await send(chatId, reply);
    }
  } catch (e) {
    console.error('[poll error]', e.message);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('🤖 Local Bot khởi động...');
console.log(`📁 Project: ${PROJECT_DIR}`);
console.log(`🔒 Admin ID: ${ADMIN_ID}`);
console.log(`🌐 Server: ${isServerRunning() ? '✅ localhost:8899 đang chạy' : '❌ Chưa chạy'}`);
console.log('─────────────────────────────');
console.log('Nhắn /start trên Telegram để bắt đầu!');
console.log('Ctrl+C để thoát.\n');

// Gửi thông báo khởi động
if (ADMIN_ID) {
  tgRequest('sendMessage', {
    chat_id: ADMIN_ID,
    text: `🟢 *Local Bot đã online!*\n📁 ${PROJECT_DIR}\n🌐 Server: ${isServerRunning() ? 'localhost:8899 ✅' : 'chưa chạy ❌'}\n\nNhắn /status để kiểm tra hoặc chat tự nhiên!`,
    parse_mode: 'Markdown'
  });
}

setInterval(poll, 1000);
