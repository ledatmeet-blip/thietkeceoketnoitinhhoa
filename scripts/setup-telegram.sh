#!/bin/bash
# Chạy sau khi deploy lên Vercel để đăng ký webhook Telegram
# Sử dụng: bash scripts/setup-telegram.sh

BOT_TOKEN="${TELEGRAM_BOT_TOKEN}"
WEBHOOK_URL="https://thietkeceoketnoitinhhoa.vercel.app/api/telegram"

if [ -z "$BOT_TOKEN" ]; then
  echo "❌ Chưa set TELEGRAM_BOT_TOKEN"
  echo "   export TELEGRAM_BOT_TOKEN='your_token_here'"
  exit 1
fi

echo "🔗 Đang đăng ký webhook..."
RESULT=$(curl -s -X POST \
  "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${WEBHOOK_URL}\", \"allowed_updates\": [\"message\", \"edited_message\"]}")

echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('✅ Thành công!' if d.get('ok') else '❌ Lỗi: '+d.get('description','?'))"

echo ""
echo "📋 Kiểm tra webhook:"
curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo" | python3 -c "
import json,sys
d=json.load(sys.stdin)
r=d.get('result',{})
print('URL:', r.get('url'))
print('Pending:', r.get('pending_update_count',0))
print('Error:', r.get('last_error_message','none'))
"
