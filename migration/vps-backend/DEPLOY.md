# Deploy toàn bộ backend lên VPS — hướng dẫn từng bước

Điều kiện trước khi bắt đầu: đã mua VPS (xem cấu hình khuyên dùng ở phần trước), đã chạy xong
`migration/backup-supabase.js` (có file dump DB + thư mục Storage), và đã có quyền truy cập DNS
của domain `ceoketnoitinhhoa.vn`.

## Bước 1 — Setup VPS (chạy 1 lần)

```bash
ssh root@<vps-ip>
# Copy nội dung file migration/vps-backend/setup-vps.sh lên VPS (scp hoặc dán tay), rồi:
sudo bash setup-vps.sh
```
Script tự cài Postgres, Node 20, Nginx, Certbot, PM2, UFW, fail2ban, tạo sẵn database +
user Postgres riêng cho app. Cuối script in ra đường dẫn file chứa connection string DB
(`/root/ceoketnoitinhhoa-db-credentials.txt`, chmod 600) — **đọc file này trên chính VPS**
(`cat /root/ceoketnoitinhhoa-db-credentials.txt`), đừng dán vào chat.

## Bước 2 — Restore dữ liệu đã backup

Từ máy Mac, copy file dump + thư mục Storage lên VPS:
```bash
scp migration/backup/db-dump-*.sql root@<vps-ip>:/root/
cd migration/backup/storage && tar czf storage.tar.gz */ && scp storage.tar.gz root@<vps-ip>:/root/
```
Trên VPS:
```bash
# Restore database — dùng connection string trong file credentials ở Bước 1
psql "postgresql://ceo_app:<pass>@localhost:5432/ceoketnoitinhhoa" -f /root/db-dump-*.sql

# Giải nén file Storage vào đúng thư mục upload đã tạo sẵn
tar xzf /root/storage.tar.gz -C /var/www/ceoketnoitinhhoa-uploads --strip-components=2
chown -R www-data:www-data /var/www/ceoketnoitinhhoa-uploads
```
(`--strip-components=2` vì cấu trúc trong tar là `<timestamp>/<path-gốc-trên-Supabase>/...`,
bỏ 2 cấp đầu để file nằm thẳng trong thư mục upload — kiểm `ls /var/www/ceoketnoitinhhoa-uploads`
thấy đúng cấu trúc ảnh/video gốc trước khi đi tiếp.)

## Bước 3 — Deploy code backend

```bash
# Trên VPS
mkdir -p /opt/ceoketnoitinhhoa-api
# Copy toàn bộ thư mục migration/vps-backend/ lên đây (scp -r hoặc git clone riêng 1 repo nhỏ)
cd /opt/ceoketnoitinhhoa-api
npm install --production
cp .env.example .env
nano .env   # điền DATABASE_URL (từ Bước 1), ADMIN_EMAIL/ADMIN_PASS/SEPAY_WEBHOOK_KEY/
            # TELEGRAM_*/GEMINI_* — copy Y NGUYÊN giá trị đang set trên Vercel hiện tại
            # (Vercel Dashboard → Project Settings → Environment Variables → bấm icon mắt
            # để xem từng biến KHÔNG đánh dấu Sensitive; biến Sensitive thì không xem lại
            # được qua Vercel nữa — lấy từ nguồn gốc: Supabase dashboard/Telegram BotFather/
            # Google AI Studio tương ứng).
```

## Bước 4 — Nginx + SSL cho domain API

```bash
cp nginx.conf.example /etc/nginx/sites-available/api.ceoketnoitinhhoa.vn
ln -s /etc/nginx/sites-available/api.ceoketnoitinhhoa.vn /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```
**Trỏ DNS trước khi chạy certbot** (certbot cần domain đã phân giải ra đúng IP VPS mới xin được
chứng chỉ): vào nơi quản lý DNS domain `ceoketnoitinhhoa.vn` (nhà đăng ký domain hoặc Cloudflare
nếu dùng), thêm:

| Loại | Tên | Giá trị |
|---|---|---|
| A | `api` | `<IP VPS>` |

Đợi vài phút tới khi `dig api.ceoketnoitinhhoa.vn` trả đúng IP VPS, rồi:
```bash
certbot --nginx -d api.ceoketnoitinhhoa.vn
```

## Bước 5 — Chạy backend qua PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # làm theo lệnh nó in ra để PM2 tự khởi động lại khi VPS reboot
```
Kiểm tra: `curl https://api.ceoketnoitinhhoa.vn/health` phải trả `{"ok":true,...}`.

## Bước 6 — Test kỹ trước khi cắt traffic thật

```bash
curl https://api.ceoketnoitinhhoa.vn/read | head -c 200   # phải trả JSON dữ liệu thật đã restore
```
Mở Admin Panel trên bản Vercel hiện tại (CHƯA đổi gì), thử tạm trỏ 1 request thủ công (hoặc
sửa tạm `API_BASE` trong console trình duyệt) để chắc login admin, đọc dữ liệu, upload ảnh thử
đều chạy đúng qua domain mới — **trước khi sửa index.html thật**.

## Bước 7 — Áp dụng thay đổi index.html

Làm theo `CLIENT-PATCH.md` — sửa xong, test local (`python3 -m http.server`), commit + push
khi đã chắc chắn.

## Bước 8 — Đổi webhook SePay

1. Đăng nhập **my.sepay.vn** (hoặc trang quản trị SePay đang dùng) → mục **Webhook** /
   **Tích hợp API**.
2. Tìm webhook đang trỏ `https://ceoketnoitinhhoa.vn/api/payment-webhook` → sửa thành:
   ```
   https://api.ceoketnoitinhhoa.vn/payment-webhook
   ```
3. Giữ nguyên **Authorization header** (`Apikey <SEPAY_WEBHOOK_KEY>`) — giá trị key phải khớp
   đúng `SEPAY_WEBHOOK_KEY` đã điền trong `.env` ở Bước 3.
4. Bấm "Test webhook" (nếu SePay có nút này) hoặc chuyển khoản thật 1 giao dịch nhỏ để xác nhận
   VPS nhận được — xem log: `pm2 logs ceoketnoitinhhoa-api`.
5. **Firewall**: nếu VPS giới hạn IP nguồn gọi vào, phải mở đúng dải IP SePay công bố (trang
   docs.sepay.vn → mục Webhook → IP addresses) — bao gồm cả IP bổ sung gần nhất SePay thông báo.

## Bước 9 — Đổi webhook Telegram bot

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://api.ceoketnoitinhhoa.vn/telegram"
```
Kiểm lại: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` phải trả đúng URL mới.

## Bước 10 — Theo dõi sau khi cắt

- `pm2 logs ceoketnoitinhhoa-api --lines 100` — xem lỗi runtime.
- `pm2 monit` — xem CPU/RAM theo thời gian thực.
- Theo dõi sát 24-48h đầu. Nếu có sự cố nghiêm trọng: trỏ lại `API_BASE` trong index.html về
  `/api` (path tương đối) và push lại — Vercel vẫn còn nguyên code cũ trong lịch sử git, rollback
  được trong vài phút.

## Backup định kỳ (sau khi đã ổn định trên VPS)

Thêm cron job tự `pg_dump` hằng ngày — Postgres tự host không còn backup tự động như Supabase:
```bash
crontab -e
# Thêm dòng:
0 3 * * * pg_dump postgresql://ceo_app:<pass>@localhost:5432/ceoketnoitinhhoa > /root/backups/db-$(date +\%F).sql
```
