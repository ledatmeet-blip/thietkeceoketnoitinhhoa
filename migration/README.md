# Migration: Supabase → VPS

## Bước 1 — Backup 100% dữ liệu Supabase

1. Cài dependency:
   ```bash
   cd migration
   npm install
   ```
2. Copy `.env.example` thành `.env`, tự điền 3 giá trị thật từ Supabase Dashboard
   (xem hướng dẫn chi tiết ngay trong file `.env.example`). **Không gõ/dán các giá trị
   này vào khung chat với Claude** — `.env` đã được `.gitignore` chặn, không bao giờ commit.
3. Chạy:
   ```bash
   npm run backup
   ```
4. Kết quả nằm trong `migration/backup/` (thư mục này cũng bị `.gitignore` chặn,
   không commit — chứa dữ liệu thật của site):
   - `db-dump-<timestamp>.sql` — toàn bộ database (schema + data, dùng `pg_dump`).
   - `storage/<timestamp>/` — toàn bộ file trong Storage bucket, giữ nguyên cấu trúc
     thư mục/tên file gốc, kèm `_manifest.json` liệt kê từng file + trạng thái tải.

Script tự kiểm và báo đỏ nếu: file dump rỗng bất thường, tải file Storage lỗi, hoặc
kích thước file tải về không khớp kích thước Supabase báo — không có nghĩa "chạy xong
không báo lỗi" = "backup đủ 100%", phải xem dòng tổng kết cuối cùng.

## Bước 2 — Restore vào Postgres trên VPS (sau khi có VPS)

```bash
# Trên VPS, sau khi đã cài Postgres và tạo database rỗng:
psql "postgresql://<user>:<pass>@localhost:5432/<dbname>" -f db-dump-<timestamp>.sql
```

## Bước 3 — Copy file Storage vào VPS

```bash
# Từ máy Mac, nén rồi scp sang VPS (thay <vps-ip> và đường dẫn thật):
cd migration/backup/storage
tar czf storage.tar.gz <timestamp>/
scp storage.tar.gz user@<vps-ip>:/path/to/uploads/
```

Rồi trên VPS: giải nén, trỏ Nginx serve thư mục đó làm static files (thay cho Supabase
Storage public URL).
