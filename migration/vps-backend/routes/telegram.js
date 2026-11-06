// POST /telegram — webhook bot Telegram (@ceoketnoitinhhoa_admin_bot). Y HỆT /api/telegram.js
// cũ, chỉ khác: đọc/ghi site_data gọi thẳng hàm nội bộ (readAllSiteData/writeSiteDataKey) thay
// vì fetch HTTP sang chính domain mình — nhanh hơn, không phụ thuộc domain nào.
//
// Nhớ đổi webhook Telegram sang URL mới sau khi deploy (xem DEPLOY.md):
//   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://api.ceoketnoitinhhoa.vn/telegram"
'use strict';
const express = require('express');
const { readAllSiteData, writeSiteDataKey } = require('../lib/db');
const { BOT_TOKEN, ADMIN_IDS } = require('../lib/telegram');

const router = express.Router();

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASS = process.env.ADMIN_PASS;

// ── Conversation memory (per chat, in-memory — sống trong lúc process còn chạy; trên VPS với
// PM2 process thường trực, lịch sử bền hơn hẳn Vercel edge function trước đây hay bị "nguội") ──
const _history = new Map();
const MAX_HIST = 24;

function getHistory(chatId) { return _history.get(String(chatId)) || []; }
function pushHistory(chatId, role, text) {
  const key = String(chatId);
  const hist = _history.get(key) || [];
  hist.push({ role, parts: [{ text }] });
  if (hist.length > MAX_HIST) hist.splice(0, hist.length - MAX_HIST);
  _history.set(key, hist);
}

let _liveCache = { text: '', at: 0 };
const LIVE_TTL_MS = 3 * 60 * 1000;

function fmtDate(ts) {
  try { return new Date(ts).toLocaleDateString('vi-VN'); } catch (e) { return ''; }
}

async function fetchLiveContext() {
  const now = Date.now();
  if (_liveCache.text && now - _liveCache.at < LIVE_TTL_MS) return _liveCache.text;

  try {
    const d = await readAllSiteData();
    const ceos = Array.isArray(d['ceo-profiles-v2']) ? d['ceo-profiles-v2'] : [];
    const leads = Array.isArray(d['all-leads-v1']) ? d['all-leads-v1'] : [];
    const joinReqs = Array.isArray(d['community-join-requests-v1']) ? d['community-join-requests-v1'] : [];
    const testimonials = Array.isArray(d['ceo-testimonials-v1']) ? d['ceo-testimonials-v1'] : [];
    const products = Array.isArray(d['ceo-showcase-prods-v1']) ? d['ceo-showcase-prods-v1'] : [];
    const events = Array.isArray(d['ceo-events-v1']) ? d['ceo-events-v1'] : [];
    const wsRegs = Array.isArray(d['ws-registrations-v1']) ? d['ws-registrations-v1'] : [];
    const wsAppts = Array.isArray(d['ws-appointments-v1']) ? d['ws-appointments-v1'] : [];
    const pricing = d['ceo-pricing-v1'] || {};

    const pendingJoin = joinReqs.filter(r => r.status === 'pending').length;
    const recentLeads = leads.slice(-5).reverse().map(l =>
      `  • [${l.source || '?'}] ${l.name || '—'} (${l.phone || l.email || '—'}) — ${fmtDate(l.date || l.createdAt)}`
    ).join('\n');

    const text = [
      `── DỮ LIỆU THẬT (live, vừa lấy từ Postgres) ──`,
      `CEO thành viên: ${ceos.length} hồ sơ${ceos.length ? ' — ' + ceos.slice(0, 12).map(c => c.name).filter(Boolean).join(', ') : ''}`,
      `Tổng leads/yêu cầu đã nhận: ${leads.length}`,
      recentLeads ? `5 lead gần nhất:\n${recentLeads}` : '',
      `Yêu cầu tham gia cộng đồng đang chờ duyệt: ${pendingJoin}/${joinReqs.length}`,
      `Đánh giá khách hàng (testimonials): ${testimonials.length}`,
      `Sản phẩm trên Sàn Sản Phẩm: ${products.length}`,
      `Sự kiện đã tạo: ${events.length}`,
      `Đăng ký workshop: ${wsRegs.length} | Lịch hẹn CEO: ${wsAppts.length}`,
      pricing.priceNew ? `Giá sách hiện tại: ${pricing.priceNew} (gốc ${pricing.priceOld || '?'})` : '',
    ].filter(Boolean).join('\n');

    _liveCache = { text, at: now };
    return text;
  } catch (e) {
    return '(Không lấy được dữ liệu live lúc này — trả lời dựa trên kiến trúc hệ thống bên dưới, nói rõ với Lê Đạt là số liệu có thể chưa cập nhật.)';
  }
}

// ── System prompt tĩnh — kiến trúc & thương hiệu dự án ──
// LƯU Ý: đoạn "★ VỀ WEBSITE" dưới đây mô tả kiến trúc CŨ (Supabase/Vercel) — sau khi di dời
// xong sang VPS, cập nhật lại đoạn này cho khớp hạ tầng mới (Postgres tự host, VPS, domain
// api.ceoketnoitinhhoa.vn) để bot không báo sai kiến trúc khi Đạt hỏi.
const SYSTEM_TEXT = `Bạn là cánh tay phải kỹ thuật + kinh doanh của Lê Đạt (ledat.meet@gmail.com) — founder website "CLB CEO Kết Nối Tinh Hoa". Bạn KHÔNG phải chatbot hỗ trợ chung chung, bạn là người hiểu dự án này sâu hơn cả chính Lê Đạt vì bạn nắm toàn bộ code, dữ liệu sống và lịch sử quyết định.

★ PHONG CÁCH BẮT BUỘC — NÓI CHUYỆN NHƯ NGƯỜI THẬT, ĐỜI THƯỜNG:
- Nhắn như đang nhắn tin Zalo/Telegram cho bạn thân, KHÔNG phải viết báo cáo hay văn bản trang trọng. Câu ngắn, tự nhiên, được phép viết kiểu nói (vd "ừ", "à mà", "thiệt ra", "nói chung", "kiểu vậy đó", "ok đó") khi hợp ngữ cảnh — nhưng đừng gồng, đừng cố tỏ ra "thân" một cách giả trân.
- Không mở đầu bằng "Tôi sẽ...", "Chào bạn...", "Dạ...", không lặp lại câu hỏi trước khi trả lời, không chốt câu kiểu văn mẫu ("Hy vọng điều này hữu ích!"). Vào thẳng vấn đề như người đang gõ tin nhắn thật.
- Câu dài ngắn xen kẽ tự nhiên như văn nói, không cần đúng ngữ pháp sách vở, không cần mở-thân-kết. Đa số tin nhắn nên ngắn — 1-3 câu là đủ trừ khi Đạt hỏi cái cần giải thích kỹ.
- Hạn chế liệt kê gạch đầu dòng/markdown nặng nề trừ khi thật sự cần liệt kê nhiều mục (vd danh sách số liệu) — mặc định trả lời bằng đoạn văn nói chuyện bình thường.
- Giọng thẳng thắn, vui vẻ, lạc quan, có chút hài hước nhẹ, tạo năng lượng để Đạt muốn làm tiếp — không sáo rỗng, không nịnh, không giả tạo.
- Khi không chắc số liệu → nói thẳng kiểu "cái này chưa chắc à, để check lại" thay vì bịa hay vòng vo.
- Emoji dùng như người thật dùng — thỉnh thoảng, đúng chỗ, không phải cứ mỗi câu 1 emoji.

★ VỀ WEBSITE — CLB CEO KẾT NỐI TINH HOA:
Domain chính thức: https://ceoketnoitinhhoa.vn. Backend/API đã di dời sang VPS riêng (trước đây chạy Vercel serverless + Supabase).
Repo GitHub: ledatmeet-blip/thietkeceoketnoitinhhoa (nhánh main — phần index.html vẫn deploy qua Vercel như cũ; phần api/backend giờ chạy trên VPS, không còn auto-deploy qua Vercel nữa).
Kiến trúc: single-file index.html (HTML/CSS/JS gộp) deploy Vercel + backend Express chạy trên VPS (PM2 + Nginx + SSL Let's Encrypt).
Database: PostgreSQL tự host trên VPS (bảng site_data key-value JSONB) — đã di dời khỏi Supabase.
Lưu ảnh/video: lưu trực tiếp trên ổ đĩa VPS, phục vụ qua Nginx/Express static — đã thay thế Supabase Storage.
2 tài khoản admin full quyền: ledat.meet@gmail.com (chính) và tuvanabc08@gmail.com (thêm gần đây) — cả 2 sửa/xoá/thêm mọi nội dung, mọi thay đổi tự sync Postgres trên VPS.

★ CÁC HỆ THỐNG CRUD ADMIN ĐÃ XÂY:
- Đánh giá khách hàng (Testimonials) — thêm/sửa/xoá, ảnh riêng biệt từng người.
- Pricing/Bonus (giá sách, ưu đãi, bonus 1-4) — sửa toàn bộ qua click-to-edit.
- Tác giả (Author section) — panel sửa trực tiếp khi ở admin mode.
- Nội dung Sách (5 Chương) — tab riêng trong Admin Panel, sửa tiêu đề/mô tả/bullet từng chương.
- Sàn Sản Phẩm (marketplace) — CEO đăng sản phẩm, admin duyệt, khách bấm vào xem chi tiết + gửi yêu cầu đặt hàng → lưu lead + Telegram notify + hướng khách tới đăng ký thành viên.
- Cộng đồng — form xin tham gia, admin duyệt/từ chối.
- Leads report — gộp mọi loại yêu cầu (đặt sách, workshop, lịch hẹn CEO, ceo_connect, membership, product_order).

★ BOT TELEGRAM NÀY:
Route /telegram (webhook chat AI — chính là bạn) và /telegram-notify (website tự bắn thông báo sự kiện: đơn hàng mới, đăng ký workshop, yêu cầu đặt hàng sản phẩm, lịch hẹn CEO, yêu cầu tham gia cộng đồng...), đều chạy trên VPS cùng 1 Express app.
Bot: @ceoketnoitinhhoa_admin_bot.

★ BRAND STYLE:
Dark theme nền xanh lục đậm có chiều sâu (nhiều lớp gradient/glow), điểm nhấn xanh lục sáng bóng (#22c55e sáng / #15803d đậm, gradient 2 tông). Định vị: CEO cao cấp, sang trọng, đáng tin cậy, đẳng cấp.

★ CÁCH DÙNG DỮ LIỆU LIVE:
Mỗi tin nhắn bạn nhận đều kèm một khối "DỮ LIỆU THẬT" lấy trực tiếp từ Postgres trên VPS ngay lúc trả lời — LUÔN ưu tiên số liệu đó hơn bất kỳ con số nào bạn nhớ trong prompt này (vì hồ sơ CEO, leads, sản phẩm... thay đổi liên tục do admin tự thêm/sửa).

Nhớ: Đạt cần tốc độ, sự thật, và năng lượng. Đừng làm phức tạp cái đơn giản. Đừng đoán mò số liệu — luôn bám dữ liệu live.`;

async function askAI(chatId, history) {
  const liveContext = await fetchLiveContext();
  const fullSystem = `${SYSTEM_TEXT}\n\n${liveContext}`;

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: history,
        systemInstruction: { parts: [{ text: fullSystem }] },
        generationConfig: { temperature: 0.85, maxOutputTokens: 2048 },
      }),
    }
  );

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('[gemini]', JSON.stringify(data).slice(0, 500));
    return '⚡ AI đang trục trặc chút, thử lại sau vài giây nhé!';
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '🤔 Không nhận được phản hồi, hỏi lại giúp mình nhé.';
}

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

async function tgAnswerCallback(callbackId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text, show_alert: false }),
  }).catch(() => {});
}

async function tgEditText(chatId, messageId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [] },
    }),
  }).catch(() => {});
}

function parseArr(v) {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v || '[]'); } catch (e) { return []; }
}

async function getJoinRequests() {
  const d = await readAllSiteData();
  return parseArr(d['community-join-requests-v1']);
}

async function setJoinRequestStatus(idOrEmail, status) {
  const reqs = await getJoinRequests();
  const needle = (idOrEmail || '').trim().toLowerCase();
  const req = reqs.find(r => r.id === idOrEmail || (r.email || '').trim().toLowerCase() === needle);
  if (!req) return null;
  req.status = status;
  await writeSiteDataKey('community-join-requests-v1', reqs);
  return req;
}

async function cmdListPending(chatId) {
  const reqs = await getJoinRequests();
  const pending = reqs.filter(r => r.status === 'pending');
  if (!pending.length) {
    await tgSend(chatId, '📭 Không có yêu cầu tham gia cộng đồng nào đang chờ duyệt.');
    return;
  }
  const shown = pending.slice(0, 15);
  const listText = shown.map((r, i) => `${i + 1}. ${r.name || '—'} — ${r.email || '—'}`).join('\n');
  const rows = shown.map(r => ([
    { text: `✅ ${(r.name || r.email || '—').slice(0, 22)}`, callback_data: `apj:${r.id}` },
    { text: '🚫 Từ chối', callback_data: `rej:${r.id}` },
  ]));
  await tgSend(chatId,
    `🪪 *${pending.length} yêu cầu đang chờ duyệt*\n\n${listText}\n\nBấm nút bên dưới để duyệt nhanh 👇`,
    { reply_markup: { inline_keyboard: rows } }
  );
}

async function handleCallbackQuery(cq) {
  const chatId = String(cq.message?.chat?.id || '');
  const messageId = cq.message?.message_id;
  const data = cq.data || '';

  if (ADMIN_IDS.length && !ADMIN_IDS.includes(chatId)) {
    await tgAnswerCallback(cq.id, '🔒 Không có quyền.');
    return;
  }

  const [action, id] = data.split(':');
  if (!id || (action !== 'apj' && action !== 'rej')) {
    await tgAnswerCallback(cq.id, '');
    return;
  }

  const status = action === 'apj' ? 'approved' : 'rejected';
  const req = await setJoinRequestStatus(id, status);
  if (!req) {
    await tgAnswerCallback(cq.id, '⚠️ Không tìm thấy (có thể đã xử lý rồi).');
    return;
  }

  await tgAnswerCallback(cq.id, status === 'approved' ? '✅ Đã duyệt!' : '🚫 Đã từ chối.');

  const label = status === 'approved' ? '✅ *ĐÃ DUYỆT THÀNH VIÊN*' : '🚫 *ĐÃ TỪ CHỐI*';
  const newText = `${label}\n👤 ${req.name || '—'}\n📧 ${req.email || '—'}`;
  if (chatId && messageId) await tgEditText(chatId, messageId, newText);
}

router.post('/', async (req, res) => {
  const update = req.body;
  if (!update) return res.send('ok');

  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query);
    return res.send('ok');
  }

  const msg = update.message || update.edited_message;
  if (!msg?.text) return res.send('ok');

  const chatId = String(msg.chat.id);
  const text = msg.text.trim();

  if (ADMIN_IDS.length && !ADMIN_IDS.includes(chatId)) {
    await tgSend(chatId, '🔒 Bot này chỉ dành cho admin CLB CEO Kết Nối Tinh Hoa.');
    return res.send('ok');
  }

  if (text === '/start') {
    await tgSend(chatId,
      `👋 Chào Đạt!\n\n` +
      `Mình là cánh tay phải của bạn cho *CEO Kết Nối Tinh Hoa* — nắm hết code, dữ liệu sống, mọi thứ 🧠\n\n` +
      `Hỏi thẳng đi, đừng ngại dài dòng, mình hiểu hết!\n\n` +
      `/duyet — xem & duyệt nhanh yêu cầu tham gia cộng đồng đang chờ\n` +
      `/duyet email@... — duyệt thẳng 1 người theo email\n` +
      `/tuchoi email@... — từ chối 1 người theo email\n` +
      `/clear — reset cuộc trò chuyện`
    );
    return res.send('ok');
  }

  if (text === '/clear') {
    _history.delete(chatId);
    await tgSend(chatId, '🧹 Xoá lịch sử xong, bắt đầu lại nào 🚀');
    return res.send('ok');
  }

  if (text === '/duyet' || text.startsWith('/duyet ')) {
    const arg = text.slice('/duyet'.length).trim();
    if (!arg) { await cmdListPending(chatId); return res.send('ok'); }
    const r = await setJoinRequestStatus(arg, 'approved');
    await tgSend(chatId, r ? `✅ Đã duyệt: *${r.name || r.email}*` : `⚠️ Không tìm thấy yêu cầu khớp "${arg}"`);
    return res.send('ok');
  }

  if (text.startsWith('/tuchoi')) {
    const arg = text.slice('/tuchoi'.length).trim();
    if (!arg) { await tgSend(chatId, 'Dùng: /tuchoi email@...'); return res.send('ok'); }
    const r = await setJoinRequestStatus(arg, 'rejected');
    await tgSend(chatId, r ? `🚫 Đã từ chối: *${r.name || r.email}*` : `⚠️ Không tìm thấy yêu cầu khớp "${arg}"`);
    return res.send('ok');
  }

  // ── AI Chat ───────────────────────────────────────────────────────────────
  await tgAction(chatId);

  pushHistory(chatId, 'user', text);
  const reply = await askAI(chatId, getHistory(chatId));
  pushHistory(chatId, 'model', reply);

  if (reply.length > 3800) {
    const chunks = reply.match(/.{1,3800}(\n|$)/gs) || [reply];
    for (const chunk of chunks) await tgSend(chatId, chunk);
  } else {
    await tgSend(chatId, reply);
  }

  return res.send('ok');
});

module.exports = router;
