// Trợ lý AI công khai cho khách ghé website (khác hẳn /api/telegram.js — bot đó là "cánh tay phải"
// riêng của admin qua Telegram). Endpoint này dùng LẠI đúng bộ não Gemini + cách lấy dữ liệu live
// đã setup cho bot Telegram, nhưng với persona/tầm nhìn dành cho khách công khai, và bắn thông báo
// có khách đang chat AI về cho admin qua Telegram (tái dùng BOT_TOKEN/ADMIN_IDS đã có sẵn).
export const config = { runtime: 'edge' };

const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY   = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const ADMIN_IDS    = (process.env.TELEGRAM_ADMIN_CHAT_ID || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const SITE_URL     = 'https://ceoketnoitinhhoa.vn';

// ── Dữ liệu live công khai — chỉ số liệu an toàn để khách thấy, KHÔNG kèm lead/thông tin nội bộ ──
let _liveCache = { text: '', at: 0 };
const LIVE_TTL_MS = 3 * 60 * 1000;

async function fetchPublicLiveContext() {
  const now = Date.now();
  if (_liveCache.text && now - _liveCache.at < LIVE_TTL_MS) return _liveCache.text;

  try {
    const r = await fetch(`${SITE_URL}/api/read`, { cache: 'no-store' });
    const d = await r.json();

    const ceos     = Array.isArray(d['ceo-profiles-v2']) ? d['ceo-profiles-v2'] : [];
    const events    = Array.isArray(d['ceo-events-v1']) ? d['ceo-events-v1'] : [];
    const pricing   = d['ceo-pricing-v1'] || {};
    const contact   = d['ceo-contact-v1'] || {};

    const upcoming = events.filter(e => e && e.date && new Date(e.date) >= new Date())
      .slice(0, 3).map(e => `  • ${e.title || 'Sự kiện'} — ${e.date}`).join('\n');

    const text = [
      `── DỮ LIỆU THẬT (live) ──`,
      `Số CEO/doanh nghiệp thành viên: ${ceos.length}`,
      pricing.priceNew ? `Giá sách "Kiến Tạo Giá Trị · Lan Tỏa Tinh Hoa" hiện tại: ${pricing.priceNew}đ${pricing.priceOld ? ' (giá gốc ' + pricing.priceOld + 'đ)' : ''}` : '',
      upcoming ? `Sự kiện sắp tới:\n${upcoming}` : '',
      contact.phone ? `Hotline: ${contact.phone}` : '',
    ].filter(Boolean).join('\n');

    _liveCache = { text, at: now };
    return text;
  } catch (e) {
    return '';
  }
}

// ── System prompt — persona KHÁCH CÔNG KHAI, tuyệt đối không lộ thông tin kỹ thuật/nội bộ ──
const SYSTEM_TEXT = `Bạn là trợ lý AI tư vấn trên website CLB CEO Kết Nối Tinh Hoa (ceoketnoitinhhoa.vn) — câu lạc bộ kết nối doanh nhân/CEO, có sách "Kiến Tạo Giá Trị · Lan Tỏa Tinh Hoa", sàn sản phẩm giao thương giữa các thành viên, workshop/sự kiện, và dịch vụ đặt lịch gặp trực tiếp CEO thành viên.

★ VAI TRÒ: Tư vấn khách ghé thăm website — giới thiệu CLB, quyền lợi thành viên, cách tham gia cộng đồng, sản phẩm trên sàn, cách đặt lịch gặp CEO, cách thanh toán/đặt sách. Mục tiêu: giúp khách hiểu rõ giá trị và dẫn dắt họ tới hành động phù hợp (tham gia cộng đồng, đặt lịch gặp CEO, đặt sách, xem sản phẩm).

★ PHONG CÁCH: Thân thiện, nhiệt tình, chuyên nghiệp nhưng gần gũi — xưng "em", gọi khách "anh/chị". Câu trả lời ngắn gọn, súc tích (2-4 câu là đủ trừ khi khách hỏi cần giải thích kỹ). Không sáo rỗng, không chèn ép bán hàng lộ liễu — tư vấn thật lòng.

★ KHÔNG BIẾT THÌ NÓI THẲNG: Nếu câu hỏi ngoài phạm vi CLB hoặc không chắc chắn, nói thật là chưa rõ, đề nghị khách liên hệ hotline hoặc Zalo trên website để được hỗ trợ trực tiếp.

★ BẢO MẬT — TUYỆT ĐỐI KHÔNG được tiết lộ: code, kiến trúc kỹ thuật, database, admin panel, API key, quy trình nội bộ, hay bất kỳ thông tin vận hành nào không dành cho công chúng. Bạn chỉ là trợ lý tư vấn cho khách, không phải kỹ thuật viên.

Luôn ưu tiên số liệu trong khối "DỮ LIỆU THẬT" (nếu có) hơn bất kỳ điều gì bạn nhớ, vì dữ liệu này lấy trực tiếp từ hệ thống ngay lúc trả lời.`;

async function askAI(history, liveContext) {
  const fullSystem = liveContext ? `${SYSTEM_TEXT}\n\n${liveContext}` : SYSTEM_TEXT;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: history,
        systemInstruction: { parts: [{ text: fullSystem }] },
        generationConfig: { temperature: 0.8, maxOutputTokens: 800 },
      }),
    }
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('[website-chat/gemini]', JSON.stringify(data).slice(0, 500));
    return null;
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function tgNotifyNewChat(firstMessage) {
  if (!BOT_TOKEN || !ADMIN_IDS.length) return;
  const text = `💬 *KHÁCH ĐANG CHAT VỚI AI TRÊN WEBSITE*\n📝 "${String(firstMessage).slice(0, 300)}"\n🕐 ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`;
  await Promise.all(ADMIN_IDS.map(chatId =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    }).catch(() => {})
  ));
}

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  if (!GEMINI_KEY) return new Response(JSON.stringify({ error: 'AI chưa được cấu hình' }), { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } });

  const body = await req.json().catch(() => null);
  if (!body || !body.message || typeof body.message !== 'string') {
    return new Response(JSON.stringify({ error: 'Thiếu nội dung tin nhắn' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const message = body.message.trim().slice(0, 2000);
  const clientHistory = Array.isArray(body.history) ? body.history.slice(-16) : [];
  const history = [...clientHistory, { role: 'user', parts: [{ text: message }] }];

  if (body.isFirstMessage) tgNotifyNewChat(message).catch(() => {});

  const liveContext = await fetchPublicLiveContext();
  const reply = await askAI(history, liveContext);

  if (!reply) {
    return new Response(JSON.stringify({ reply: '⚡ AI đang trục trặc chút, anh/chị thử lại giúp em sau vài giây nhé!' }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ reply }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}
