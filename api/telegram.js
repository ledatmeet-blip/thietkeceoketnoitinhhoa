export const config = { runtime: 'edge' };

const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY   = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const ADMIN_ID     = process.env.TELEGRAM_ADMIN_CHAT_ID;
const SITE_URL     = 'https://ceoketnoitinhhoa.vn';

// ── Conversation memory (per chat, in-memory — sống trong lúc function còn "ấm") ──
const _history = new Map();
const MAX_HIST = 24;

function getHistory(chatId) { return _history.get(String(chatId)) || []; }
function pushHistory(chatId, role, text) {
  const key  = String(chatId);
  const hist = _history.get(key) || [];
  hist.push({ role, parts: [{ text }] });
  if (hist.length > MAX_HIST) hist.splice(0, hist.length - MAX_HIST);
  _history.set(key, hist);
}

// ── Live data cache — kéo trạng thái thật từ Supabase qua /api/read, cache 3 phút ──
let _liveCache = { text: '', at: 0 };
const LIVE_TTL_MS = 3 * 60 * 1000;

function fmtDate(ts) {
  try { return new Date(ts).toLocaleDateString('vi-VN'); } catch (e) { return ''; }
}

async function fetchLiveContext() {
  const now = Date.now();
  if (_liveCache.text && now - _liveCache.at < LIVE_TTL_MS) return _liveCache.text;

  try {
    const r = await fetch(`${SITE_URL}/api/read`, { cache: 'no-store' });
    const d = await r.json();

    const ceos       = Array.isArray(d['ceo-profiles-v2']) ? d['ceo-profiles-v2'] : [];
    const leads       = Array.isArray(d['all-leads-v1']) ? d['all-leads-v1'] : [];
    const joinReqs    = Array.isArray(d['community-join-requests-v1']) ? d['community-join-requests-v1'] : [];
    const testimonials = Array.isArray(d['ceo-testimonials-v1']) ? d['ceo-testimonials-v1'] : [];
    const products    = Array.isArray(d['ceo-showcase-prods-v1']) ? d['ceo-showcase-prods-v1'] : [];
    const events      = Array.isArray(d['ceo-events-v1']) ? d['ceo-events-v1'] : [];
    const wsRegs      = Array.isArray(d['ws-registrations-v1']) ? d['ws-registrations-v1'] : [];
    const wsAppts     = Array.isArray(d['ws-appointments-v1']) ? d['ws-appointments-v1'] : [];
    const pricing     = d['ceo-pricing-v1'] || {};

    const pendingJoin = joinReqs.filter(r => r.status === 'pending').length;
    const recentLeads = leads.slice(-5).reverse().map(l =>
      `  • [${l.source || '?'}] ${l.name || '—'} (${l.phone || l.email || '—'}) — ${fmtDate(l.date || l.createdAt)}`
    ).join('\n');

    const text = [
      `── DỮ LIỆU THẬT (live, vừa lấy từ Supabase) ──`,
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

// ── System prompt tĩnh — kiến trúc & thương hiệu dự án (cập nhật 23/07/2026) ──
const SYSTEM_TEXT = `Bạn là cánh tay phải kỹ thuật + kinh doanh của Lê Đạt (ledat.meet@gmail.com) — founder website "CLB CEO Kết Nối Tinh Hoa". Bạn KHÔNG phải chatbot hỗ trợ chung chung, bạn là người hiểu dự án này sâu hơn cả chính Lê Đạt vì bạn nắm toàn bộ code, dữ liệu sống và lịch sử quyết định.

★ PHONG CÁCH BẮT BUỘC:
- Ngắn gọn, đi thẳng vào điều Đạt hỏi — không lặp lại câu hỏi, không rào đón kiểu "Tôi sẽ giúp bạn...", không liệt kê thừa.
- Giọng thẳng thắn, thoải mái như đồng nghiệp thân, vui vẻ, lạc quan, tạo năng lượng để Đạt muốn làm tiếp — không sáo rỗng, không nịnh.
- Trả lời như một con người thông minh hiểu doanh nghiệp, KHÔNG như trợ lý máy móc.
- Khi không chắc số liệu → nói thẳng "chưa chắc, để check lại" thay vì bịa.
- Emoji dùng có chọn lọc, không lạm dụng. Tiếng Việt tự nhiên, chêm thuật ngữ kỹ thuật tiếng Anh khi cần.

★ VỀ WEBSITE — CLB CEO KẾT NỐI TINH HOA:
Domain chính thức: https://ceoketnoitinhhoa.vn (redirect www → non-www). Domain Vercel dự phòng: https://thietkeceoketnoitinhhoa.vercel.app
Repo GitHub: ledatmeet-blip/thietkeceoketnoitinhhoa (nhánh main, Vercel auto-deploy từ đây — LƯU Ý: nếu code sửa mà không git push, auto-deploy-hook sẽ ghi đè về bản git cũ, đây là bug từng gặp phải nhớ luôn commit+push trước khi deploy).
Kiến trúc: single-file index.html (HTML/CSS/JS gộp, ~470KB) + Vercel serverless functions trong /api.
Database: Supabase Postgres (bảng site_data key-value, JSONB) — ĐÃ MIGRATE từ Neon, không còn dùng Neon nữa.
Lưu ảnh: Supabase Storage (bucket ceo-site) — đã thay thế Vercel Blob hoàn toàn.
Vercel Cron: ping /api/read hằng ngày để Supabase free tier không tự pause sau 7 ngày rảnh.
2 tài khoản admin full quyền: ledat.meet@gmail.com (chính) và tuvanabc08@gmail.com (thêm gần đây) — cả 2 sửa/xoá/thêm mọi nội dung, mọi thay đổi tự sync Supabase.

★ CÁC HỆ THỐNG CRUD ADMIN ĐÃ XÂY:
- Đánh giá khách hàng (Testimonials) — thêm/sửa/xoá, ảnh riêng biệt từng người (đã fix bug ảnh bị trùng).
- Pricing/Bonus (giá sách, ưu đãi, bonus 1-4) — sửa toàn bộ qua click-to-edit.
- Tác giả (Author section) — panel sửa trực tiếp khi ở admin mode.
- Nội dung Sách (5 Chương) — tab riêng trong Admin Panel, sửa tiêu đề/mô tả/bullet từng chương.
- Sàn Sản Phẩm (marketplace) — CEO đăng sản phẩm, admin duyệt, khách bấm vào xem chi tiết + gửi yêu cầu đặt hàng → lưu lead + Telegram notify + hướng khách tới đăng ký thành viên.
- Cộng đồng — form xin tham gia, admin duyệt/từ chối.
- Leads report — gộp mọi loại yêu cầu (đặt sách, workshop, lịch hẹn CEO, ceo_connect, membership, product_order).

★ BOT TELEGRAM NÀY:
File: /api/telegram.js (webhook chat AI — chính là bạn) và /api/telegram-notify.js (website tự bắn thông báo sự kiện: đơn hàng mới, đăng ký workshop, yêu cầu đặt hàng sản phẩm, lịch hẹn CEO, yêu cầu tham gia cộng đồng...).
Bot: @ceoketnoitinhhoa_admin_bot.

★ BRAND STYLE:
Dark theme nền đen (#090604), điểm nhấn vàng gold (#f0c040). Định vị: CEO cao cấp, sang trọng, đáng tin cậy, đẳng cấp.

★ CÁCH DÙNG DỮ LIỆU LIVE:
Mỗi tin nhắn bạn nhận đều kèm một khối "DỮ LIỆU THẬT" lấy trực tiếp từ Supabase ngay lúc trả lời — LUÔN ưu tiên số liệu đó hơn bất kỳ con số nào bạn nhớ trong prompt này (vì hồ sơ CEO, leads, sản phẩm... thay đổi liên tục do admin tự thêm/sửa).

Nhớ: Đạt cần tốc độ, sự thật, và năng lượng. Đừng làm phức tạp cái đơn giản. Đừng đoán mò số liệu — luôn bám dữ liệu live.`;

// ── Gọi Gemini API (bộ não chính) ────────────────────────────────────────────
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

  const msg = update.message || update.edited_message;
  if (!msg?.text) return new Response('ok');

  const chatId = String(msg.chat.id);
  const text   = msg.text.trim();
  const from   = msg.from || {};

  // Bảo mật: chỉ admin
  if (ADMIN_ID && chatId !== String(ADMIN_ID)) {
    await tgSend(chatId, '🔒 Bot này chỉ dành cho admin CLB CEO Kết Nối Tinh Hoa.');
    return new Response('ok');
  }

  if (text === '/start') {
    await tgSend(chatId,
      `👋 Chào Đạt!\n\n` +
      `Mình là cánh tay phải của bạn cho *CEO Kết Nối Tinh Hoa* — nắm hết code, dữ liệu sống, mọi thứ 🧠\n\n` +
      `Hỏi thẳng đi, đừng ngại dài dòng, mình hiểu hết!\n\n` +
      `/clear — reset cuộc trò chuyện`
    );
    return new Response('ok');
  }

  if (text === '/clear') {
    _history.delete(chatId);
    await tgSend(chatId, '🧹 Xoá lịch sử xong, bắt đầu lại nào 🚀');
    return new Response('ok');
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

  return new Response('ok');
}
