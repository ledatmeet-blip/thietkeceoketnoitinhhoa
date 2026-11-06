# Thay đổi cần áp dụng vào index.html (CHƯA áp dụng — chỉ làm khi VPS đã chạy xong và sẵn sàng cắt)

index.html hiện gọi API bằng đường dẫn tương đối `'/api/...'` (đúng khi API và trang tĩnh nằm
chung domain trên Vercel). Sau khi API chuyển sang `api.ceoketnoitinhhoa.vn`, các path này phải
trỏ sang domain mới. **Đừng áp dụng các thay đổi này cho tới khi VPS đã chạy, DNS đã trỏ, và đã
test xong qua domain mới** — áp dụng sớm sẽ làm hỏng site đang chạy thật (gọi vào domain API
chưa tồn tại).

## 1. Thêm hằng số domain API (dán gần đầu thẻ `<script>`, cạnh các hằng số `_IS_LIVE`/`_AE`/`_AP`)

```js
const API_BASE='https://api.ceoketnoitinhhoa.vn';
```

## 2. Đổi tất cả `fetch('/api/...')` còn lại (14 chỗ, trừ upload-url và deploy xử lý riêng ở dưới)

Tìm-thay chính xác chuỗi `'/api/` → `API_BASE+'/` ở toàn bộ file (áp dụng được an toàn vì đây là
find-replace y nguyên 1 chuỗi, chỉ xuất hiện trong các lệnh `fetch(...)`, đã kiểm tra không dính
template literal nào khác):

```
fetch('/api/read'...)              →  fetch(API_BASE+'/read'...)
fetch('/api/admin'...)             →  fetch(API_BASE+'/admin'...)
fetch('/api/chat'...)              →  fetch(API_BASE+'/chat'...)
fetch('/api/payment-create'...)    →  fetch(API_BASE+'/payment-create'...)
fetch('/api/payment-status'...)    →  fetch(API_BASE+'/payment-status'...)
fetch('/api/telegram-notify'...)   →  fetch(API_BASE+'/telegram-notify'...)
fetch('/api/website-chat'...)      →  fetch(API_BASE+'/website-chat'...)
```
(Lưu ý bỏ tiền tố `/api` — route Express mới mount thẳng ở gốc, vd `/read` chứ không phải
`/api/read`, nên chuỗi thay thế là `API_BASE+'/read'` chứ KHÔNG phải `API_BASE+'/api/read'`.)

## 3. Viết lại `_uploadDirect` (dòng ~5460-5499) — bỏ hẳn Supabase Storage/signed URL

Xoá cả khối `SUPABASE_JS_CDN` / `_sbClient` / `_loadScriptOnce` / `_getSbClient` (không còn
dùng Supabase gì nữa), thay nguyên hàm `_uploadDirect` bằng:

```js
async function _uploadDirect(key,file){
  if(!_IS_LIVE||!file)return null;
  try{
    const ext=(file.name&&file.name.includes('.')?file.name.split('.').pop():(file.type||'').split('/')[1])||'bin';
    const filename=key.replace(/[^a-z0-9]/gi,'-').toLowerCase().slice(0,60)+'.'+ext.toLowerCase().replace('jpeg','jpg');
    const fd=new FormData();
    fd.append('adminEmail',_AE);
    fd.append('adminPass',_AP);
    fd.append('filename',filename);
    fd.append('file',file);
    const res=await fetch(API_BASE+'/upload',{method:'POST',body:fd});
    if(!res.ok)return null;
    const{publicUrl}=await res.json();
    return publicUrl;
  }catch(e){console.warn('[Upload] direct upload failed:',e.message);return null;}
}
```

(KHÔNG set `Content-Type` thủ công khi dùng `FormData` — trình duyệt tự thêm boundary đúng.)

## 4. `/api/deploy` (2 chỗ: `_scheduleAutoDeploy` dòng ~5306, `adminTriggerDeploy` dòng ~5317)

Tính năng "tự deploy lại Vercel sau khi admin sửa nội dung" KHÔNG còn ý nghĩa khi index.html
không còn được build lại từ dữ liệu (dữ liệu đọc live từ API lúc tải trang, không bake vào
HTML tĩnh) — an toàn để bỏ hẳn:
- Xoá hàm `_scheduleAutoDeploy` + lời gọi nó trong `_dbWrite`.
- Xoá nút "🚀 Triển Khai" trong Admin Panel + hàm `adminTriggerDeploy`.

Nếu muốn giữ nguyên tối thiểu thay đổi, có thể BỎ QUA bước này — 2 chỗ gọi `/api/deploy` đã có
try/catch, chỉ in cảnh báo console + 1 toast lỗi nếu admin bấm nút, không crash gì.

## 5. CORS khi đã ổn định

`server.js` mặc định `ALLOWED_ORIGIN=*` (giữ đúng hành vi cũ). Sau khi xác nhận mọi thứ chạy ổn
qua domain mới vài ngày, nên set trong `.env` trên VPS:
```
ALLOWED_ORIGIN=https://ceoketnoitinhhoa.vn
```
rồi `pm2 restart ceoketnoitinhhoa-api` — siết CORS lại đúng domain thật, không ai gọi ké API
được từ domain khác.
