// Website calls this endpoint to push notifications to Telegram admin
export const config = { runtime: 'edge' };

const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_IDS  = (process.env.TELEGRAM_ADMIN_CHAT_ID || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const AE         = process.env.ADMIN_EMAIL;
const AP         = process.env.ADMIN_PASS;

function fmtVnd(n) {
  if (!n) return '0';
  const num = parseInt(n, 10);
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(0) + 'K';
  return num.toString();
}

function buildMessage(event, data = {}) {
  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  switch (event) {
    case 'new_order':
      return `📦 *ĐƠN ĐẶT SÁCH MỚI*\n` +
        `👤 ${data.name || '—'}\n` +
        `📱 ${data.phone || '—'}\n` +
        `🛒 Số lượng: *${data.qty || 1} cuốn*\n` +
        `💰 Số tiền: *${fmtVnd(data.amount)}đ*\n` +
        `⏳ Trạng thái: Chờ xác nhận TK\n` +
        `🕐 ${now}`;

    case 'lead_confirmed':
      return `✅ *ĐÃ XÁC NHẬN THANH TOÁN*\n` +
        `👤 ${data.name || '—'}\n` +
        `📱 ${data.phone || '—'}\n` +
        `📂 Nguồn: ${data.source || '—'}\n` +
        `💰 Số tiền: *${fmtVnd(data.amount)}đ*\n` +
        `🕐 ${now}`;

    case 'workshop_reg':
      return `🎟️ *ĐĂNG KÝ WORKSHOP MỚI*\n` +
        `👤 ${data.name || '—'}\n` +
        `📱 ${data.phone || '—'}\n` +
        `📧 ${data.email || '—'}\n` +
        `💼 ${data.role || '—'}\n` +
        `📅 Sự kiện: ${data.event || '—'}\n` +
        (data.amount ? `💰 Phí: *${fmtVnd(data.amount)}đ*\n` : '') +
        `🕐 ${now}`;

    case 'product_order':
      return `🛍️ *YÊU CẦU ĐẶT HÀNG SẢN PHẨM*\n` +
        `👤 ${data.name || '—'}\n` +
        `📱 ${data.phone || '—'}\n` +
        `📦 Sản phẩm: *${data.productName || '—'}*\n` +
        (data.sellerName ? `🏢 Từ: ${data.sellerName}\n` : '') +
        (data.note ? `💬 Ghi chú: ${data.note}\n` : '') +
        `⏳ Chờ admin liên hệ xác nhận\n` +
        `🕐 ${now}`;

    case 'ceo_appointment':
      return `📅 *YÊU CẦU LỊCH HẸN CEO*\n` +
        `👤 Người đặt: ${data.name || '—'}\n` +
        `📱 ${data.phone || '—'}\n` +
        `🤝 CEO: *${data.ceoName || '—'}* (Mã: ${data.ceoCode || '—'})\n` +
        `📆 Ngày hẹn: ${data.date || '—'}  ${data.time || ''}\n` +
        (data.purpose ? `💬 Mục đích: ${data.purpose}\n` : '') +
        `🕐 ${now}`;

    case 'community_join_request':
      return `🪪 *YÊU CẦU THAM GIA CỘNG ĐỒNG MỚI*\n` +
        `👤 ${data.name || '—'}\n` +
        `📧 ${data.email || '—'}\n` +
        `⏳ Đang chờ admin duyệt\n` +
        `🕐 ${now}`;

    case 'community_join_approved':
      return `✅ *ĐÃ DUYỆT THÀNH VIÊN CỘNG ĐỒNG*\n` +
        `👤 ${data.name || '—'}\n` +
        `📧 ${data.email || '—'}\n` +
        `🕐 ${now}`;

    case 'ceo_profile_view':
      return `👁️ *XEM HỒ SƠ CEO*\n` +
        `🤝 CEO: *${data.ceoName || '—'}* (Mã: ${data.ceoCode || '—'})\n` +
        `👤 Người xem: ${data.viewer || 'Khách'}\n` +
        `🕐 ${now}`;

    case 'ceo_connect_intent':
      return `🔓 *QUAN TÂM KẾT NỐI CEO*\n` +
        `👤 Khách: ${data.userName || '—'}\n` +
        `🤝 CEO muốn kết nối: *${data.ceoName || '—'}* (${data.ceoCode || '—'})\n` +
        `💰 Phí: *${fmtVnd(data.amount || 299000)}đ*\n` +
        `⚡ Đang xem QR thanh toán\n` +
        `🕐 ${now}`;

    case 'ceo_connect_paid':
      return `💳 *CHỜ XÁC NHẬN — KẾT NỐI CEO*\n` +
        `👤 Khách: ${data.userName || '—'}\n` +
        `🤝 CEO: *${data.ceoName || '—'}* (${data.ceoCode || '—'})\n` +
        `💰 Số tiền: *${fmtVnd(data.amount || 299000)}đ*\n` +
        `📝 Nội dung CK: \`${data.payContent || '—'}\`\n` +
        `⏳ Khách báo đã chuyển khoản — chờ gửi mã kích hoạt\n` +
        `🕐 ${now}`;

    case 'ceo_unlock':
      return `✅ *KẾT NỐI CEO THÀNH CÔNG*\n` +
        `👤 ${data.name || '—'}\n` +
        `🤝 CEO: *${data.ceoName || '—'}*\n` +
        `💰 Đã thu: *${fmtVnd(data.amount || 299000)}đ*\n` +
        (data.message ? `💬 ${data.message}\n` : '') +
        `🕐 ${now}`;

    case 'membership_paid':
      return `💳 *CHỜ XÁC NHẬN — ĐĂNG KÝ THÀNH VIÊN CLB*\n` +
        `👤 ${data.name || '—'}\n` +
        `📧 ${data.email || '—'}\n` +
        `💰 Số tiền: *${fmtVnd(data.amount || 497000)}đ/năm*\n` +
        `📝 Nội dung CK: \`THANH VIEN CLB\`\n` +
        `⏳ Khách báo đã chuyển khoản — chờ gửi mã kích hoạt\n` +
        `🕐 ${now}`;

    case 'membership_activated':
      return `👑 *THÀNH VIÊN CLB ĐÃ KÍCH HOẠT*\n` +
        `👤 ${data.name || '—'}\n` +
        `📧 ${data.email || '—'}\n` +
        `💰 Đã thu: *${fmtVnd(data.amount || 497000)}đ*\n` +
        (data.message ? `💬 ${data.message}\n` : '') +
        `🕐 ${now}`;

    case 'product_approve':
      return `✅ *DUYỆT SẢN PHẨM CEO*\n` +
        `👤 ${data.name || '—'}\n` +
        (data.detail ? `📋 ${data.detail}\n` : '') +
        `🕐 ${now}`;

    default: {
      let text = `📌 *[${(event || 'EVENT').toUpperCase()}]*\n`;
      if (data.name)    text += `👤 ${data.name}\n`;
      if (data.phone)   text += `📱 ${data.phone}\n`;
      if (data.email)   text += `📧 ${data.email}\n`;
      if (data.message) text += `💬 ${data.message}\n`;
      if (data.detail)  text += `📋 ${data.detail}\n`;
      text += `🕐 ${now}`;
      return text;
    }
  }
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response('Bad Request', { status: 400 }); }

  if (!body.adminEmail || !body.adminPass || body.adminEmail !== AE || body.adminPass !== AP) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!BOT_TOKEN || !ADMIN_IDS.length) {
    return new Response(JSON.stringify({ ok: false, error: 'Bot not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { event, data = {} } = body;
  const text = buildMessage(event, data);

  const results = await Promise.all(ADMIN_IDS.map(chatId =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    }).then(r => r.json()).catch(() => ({ ok: false }))
  ));

  return new Response(JSON.stringify({ ok: results.some(r => r.ok) }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
