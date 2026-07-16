export const config = { runtime: 'edge' };

const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const GROQ_KEY   = process.env.GROQ_API_KEY;
const ADMIN_ID   = process.env.TELEGRAM_ADMIN_CHAT_ID;

// ── Conversation memory ───────────────────────────────────────────────────────
const _history = new Map();
const MAX_HIST  = 20;

function getHistory(chatId) { return _history.get(String(chatId)) || []; }
function pushHistory(chatId, role, text) {
  const key  = String(chatId);
  const hist = _history.get(key) || [];
  hist.push({ role, parts: [{ text }] });
  if (hist.length > MAX_HIST) hist.splice(0, hist.length - MAX_HIST);
  _history.set(key, hist);
}

// ── System prompt — toàn bộ context dự án ────────────────────────────────────
const SYSTEM_TEXT = `Bạn là trợ lý thông minh và thân thiết của Lê Đạt — quản trị viên và người sáng lập website CLB CEO Kết Nối Tinh Hoa (https://thietkeceoketnoitinhhoa.vercel.app).

PHONG CÁCH GIAO TIẾP:
- Nói chuyện thoải mái, thẳng thắn, vui vẻ như đồng nghiệp thân — không phải robot
- Ngắn gọn, đúng trọng tâm — không rào đón, không "tôi sẽ giúp bạn..."
- Tiếng Việt tự nhiên, mix tiếng Anh kỹ thuật khi cần
- Dùng emoji hợp lý, không lạm dụng
- Khi không rõ → hỏi lại ngắn, đừng đoán mò

VỀ LÊ ĐẠT:
- Email: ledat.meet@gmail.com
- Đang xây website CLB CEO Kết Nối Tinh Hoa
- Dev tại localhost:8899, chưa push Vercel cho đến khi ổn định
- Dùng Claude Code để dev trên Mac M4
- Cũng có project social-auto-poster riêng

VỀ WEBSITE CEO KẾT NỐI TINH HOA:
Tech stack: Single-file HTML/CSS/JS (~5500+ dòng), Neon PostgreSQL, Vercel Blob, Vercel Edge Functions
Live: https://thietkeceoketnoitinhhoa.vercel.app

Tính năng đã có:
✅ Admin panel đầy đủ (email: ledat.meet@gmail.com)
✅ 8 hồ sơ CEO thành viên thật
✅ Profile overlay CEO: ảnh, 11 trường thông tin, inline edit ngay tại chỗ
✅ Sàn sản phẩm: ticker VIP chạy ngang + grid sản phẩm CEO được duyệt
✅ Smart image crop (canvas center-crop đúng tỷ lệ)
✅ Auto-deploy Vercel (debounce 10s sau mỗi lần admin lưu)
✅ Neon DB sync + Vercel Blob CDN
✅ Bot Telegram này (bạn!) để notify và chat

8 thành viên CEO:
001 - Trần Thị Luyến (Chủ tịch CLB, Du lịch/Thương mại, Hà Nội)
002 - Nguyễn Thị Hương (F&B/Organic)
003 - Nguyễn Thị Hoài Thanh
004 - Mai Ái Hoa
005 - Nguyễn Thị Bích Lợi
006 - Nguyễn Thị Tâm
007 - Nguyễn Thị Kim Dung (Tiến Sỹ)
008 - Đinh Thị Ngân

API endpoints:
- /api/deploy.js — trigger Vercel rebuild
- /api/upload.js — upload ảnh lên Vercel Blob
- /api/telegram.js — webhook bot này
- /api/telegram-notify.js — website gửi thông báo

Brand style: Dark theme (#090604), vàng gold (#f0c040), phong cách CEO premium, sang trọng, tin tưởng.

THÔNG TIN KỸ THUẬT BỔ SUNG:
- _IS_LIVE flag: bỏ qua DB calls trên localhost
- _dbWrite(): ghi Neon DB + toast + auto-deploy
- CEO_PROFILES_KEY = 'ceo-profiles-v2'
- Admin password: lưu an toàn, không chia sẻ
- Vercel project: thietkeceoketnoitinhhoa

Nhớ: Lê Đạt cần tốc độ, rõ ràng và năng lượng tích cực. Đừng làm phức tạp những gì đơn giản!`;

// ── Gọi Groq API (Llama 3.3 70B — free, nhanh) ───────────────────────────────
async function askAI(messages) {
  // Convert Gemini format {role,parts} → OpenAI format {role,content}
  const oaiMsgs = messages.map(m => ({
    role: m.role === 'model' ? 'assistant' : m.role,
    content: m.parts ? m.parts[0].text : m.content,
  }));

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: SYSTEM_TEXT }, ...oaiMsgs],
      temperature: 0.8,
      max_tokens: 800,
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) return '⚡ AI đang bận, thử lại sau nhé!';
  return data.choices?.[0]?.message?.content || '🤔 Không nhận được phản hồi.';
}

// ── Gửi tin nhắn Telegram ─────────────────────────────────────────────────────
async function tgSend(chatId, text, extra = {}) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra }),
  }).catch(() => {});
}

async function tgAction(chatId) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  }).catch(() => {});
}

// ── Webhook handler ────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method !== 'POST') return new Response('ok');

  const update = await req.json().catch(() => null);
  if (!update) return new Response('ok');

  const msg  = update.message || update.edited_message;
  if (!msg?.text) return new Response('ok');

  const chatId = String(msg.chat.id);
  const text   = msg.text.trim();
  const from   = msg.from || {};

  // Bảo mật: chỉ admin
  if (ADMIN_ID && chatId !== String(ADMIN_ID)) {
    await tgSend(chatId, '🔒 Bot này chỉ dành cho admin CLB CEO Kết Nối Tinh Hoa.');
    return new Response('ok');
  }

  // ── Commands ──────────────────────────────────────────────────────────────
  if (text === '/start') {
    await tgSend(chatId,
      `👋 Chào ${from.first_name || 'Đạt'}!\n\n` +
      `Tôi là trợ lý AI của *CEO Kết Nối Tinh Hoa* — được bơm toàn bộ context dự án vào đầu 🧠\n\n` +
      `Hỏi thẳng vào việc đi, tôi hiểu hết!\n\n` +
      `*Lệnh nhanh:*\n` +
      `/web — xem status website\n` +
      `/ceos — danh sách 8 CEO thành viên\n` +
      `/clear — reset conversation\n` +
      `/help — xem tất cả lệnh`
    );
    return new Response('ok');
  }

  if (text === '/help') {
    await tgSend(chatId,
      `*📋 Danh sách lệnh:*\n\n` +
      `/start — khởi động bot\n` +
      `/web — status website & tính năng\n` +
      `/ceos — danh sách CEO thành viên\n` +
      `/clear — xóa lịch sử chat\n\n` +
      `Hoặc chat tự do — tôi hiểu mọi câu hỏi về dự án! 💬`
    );
    return new Response('ok');
  }

  if (text === '/web') {
    await tgSend(chatId,
      `🌐 *CEO Kết Nối Tinh Hoa*\n\n` +
      `• Live: https://thietkeceoketnoitinhhoa.vercel.app\n` +
      `• Dev: http://localhost:8899\n\n` +
      `*✅ Đã xây xong:*\n` +
      `→ Admin panel đầy đủ\n` +
      `→ 8 hồ sơ CEO thành viên\n` +
      `→ Sàn sản phẩm + ticker VIP\n` +
      `→ Upload ảnh smart crop\n` +
      `→ Auto-deploy Vercel\n` +
      `→ Neon DB + Vercel Blob\n` +
      `→ Bot Telegram này 🤖`
    );
    return new Response('ok');
  }

  if (text === '/ceos') {
    await tgSend(chatId,
      `*👥 8 CEO Thành Viên CLB:*\n\n` +
      `001 - Trần Thị Luyến _(Chủ tịch CLB)_\n` +
      `002 - Nguyễn Thị Hương\n` +
      `003 - Nguyễn Thị Hoài Thanh\n` +
      `004 - Mai Ái Hoa\n` +
      `005 - Nguyễn Thị Bích Lợi\n` +
      `006 - Nguyễn Thị Tâm\n` +
      `007 - Nguyễn Thị Kim Dung _(Tiến Sỹ)_\n` +
      `008 - Đinh Thị Ngân\n\n` +
      `Hỏi thêm về ai thì cứ hỏi! 👆`
    );
    return new Response('ok');
  }

  if (text === '/clear') {
    _history.delete(chatId);
    await tgSend(chatId, '🧹 Reset xong! Bắt đầu cuộc trò chuyện mới nào 🚀');
    return new Response('ok');
  }

  // ── AI Chat ───────────────────────────────────────────────────────────────
  await tgAction(chatId);

  pushHistory(chatId, 'user', text);
  const reply = await askAI(getHistory(chatId));
  pushHistory(chatId, 'model', reply); // Gemini dùng "model" thay vì "assistant"

  // Tách nếu quá dài (Telegram max 4096 ký tự)
  if (reply.length > 3800) {
    const chunks = reply.match(/.{1,3800}(\n|$)/gs) || [reply];
    for (const chunk of chunks) await tgSend(chatId, chunk);
  } else {
    await tgSend(chatId, reply);
  }

  return new Response('ok');
}
