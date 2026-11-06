#!/usr/bin/env bash
# Chạy 1 lần trên VPS mới (Ubuntu 22.04/24.04), với quyền root:
#   ssh root@<vps-ip>
#   curl -fsSL https://raw.githubusercontent.com/<your-fork>/.../setup-vps.sh | bash
# hoặc scp file này lên rồi chạy: sudo bash setup-vps.sh
#
# Script này: cài Postgres + Node.js 20 + Nginx + Certbot + PM2 + UFW + fail2ban, tạo database
# + user Postgres riêng cho app, bật firewall cơ bản. KHÔNG tự deploy code — làm xong bước này
# rồi làm theo DEPLOY.md để đưa code lên.
set -euo pipefail

echo "=============================================="
echo " Setup VPS cho ceoketnoitinhhoa.vn backend"
echo "=============================================="

if [ "$EUID" -ne 0 ]; then
  echo "Chạy script này với quyền root (sudo bash setup-vps.sh)"
  exit 1
fi

echo "[1/8] Cập nhật hệ thống..."
apt-get update -y
apt-get upgrade -y

echo "[2/8] Cài các gói cơ bản..."
apt-get install -y curl git ufw fail2ban unattended-upgrades postgresql postgresql-contrib nginx

echo "[3/8] Cài Node.js 20 LTS..."
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "[4/8] Cài PM2 (giữ Node app chạy nền, tự restart)..."
npm install -g pm2

echo "[5/8] Cài Certbot (SSL miễn phí Let's Encrypt)..."
apt-get install -y certbot python3-certbot-nginx

echo "[6/8] Tạo database + user Postgres riêng cho app..."
DB_NAME="ceoketnoitinhhoa"
DB_USER="ceo_app"
DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

# Lưu connection string vào 1 file chỉ root đọc được — KHÔNG in ra trong log chạy chung,
# để lỡ ai xem lại terminal log cũng không thấy mật khẩu DB thật.
CRED_FILE="/root/ceoketnoitinhhoa-db-credentials.txt"
echo "DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}" > "$CRED_FILE"
chmod 600 "$CRED_FILE"

echo "[7/8] Cấu hình firewall (UFW)..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
# Postgres (5432) KHÔNG mở ra ngoài — chỉ app trên cùng máy kết nối qua localhost.
ufw --force enable

echo "[8/8] Bật tự động vá bảo mật OS..."
dpkg-reconfigure -f noninteractive unattended-upgrades || true

mkdir -p /var/www/ceoketnoitinhhoa-uploads
chown -R www-data:www-data /var/www/ceoketnoitinhhoa-uploads 2>/dev/null || true

echo ""
echo "=============================================="
echo " XONG. Các bước tiếp theo (xem DEPLOY.md):"
echo "=============================================="
echo "1. Connection string DB đã lưu tại: $CRED_FILE (chmod 600, chỉ root đọc được)."
echo "   Dùng lệnh: cat $CRED_FILE   ← để copy vào file .env của app."
echo "2. Deploy code backend vào VPS, cài dependency, cấu hình .env."
echo "3. Copy nginx.conf.example vào /etc/nginx/sites-available/, trỏ domain api.ceoketnoitinhhoa.vn"
echo "4. Chạy certbot --nginx -d api.ceoketnoitinhhoa.vn để bật SSL."
echo "5. pm2 start ecosystem.config.js && pm2 save && pm2 startup"
echo "=============================================="
