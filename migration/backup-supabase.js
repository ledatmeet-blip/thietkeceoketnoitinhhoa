// Backup 100% dữ liệu Supabase (Database qua pg_dump + toàn bộ Storage bucket) để chuẩn bị
// di dời sang VPS. Chạy cục bộ: `npm install && npm run backup` trong thư mục migration/.
//
// AN TOÀN: không bao giờ in giá trị SUPABASE_DATABASE_URL / SUPABASE_SERVICE_ROLE_KEY ra
// console — chỉ in độ dài/có-hay-không, đúng Luật 2 (đừng để nó in key ra màn hình).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, '.env');
const BACKUP_DIR = path.join(ROOT, 'backup');

// ----- Nạp migration/.env thủ công (không thêm dependency dotenv) -----
function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`[backup] Không thấy ${filePath}`);
    console.error('[backup] Copy migration/.env.example thành migration/.env rồi tự điền giá trị thật (xem hướng dẫn trong file đó).');
    process.exit(1);
  }
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

function requireVar(env, key) {
  const v = env[key];
  if (!v) {
    console.error(`[backup] Thiếu ${key} trong migration/.env — xem migration/.env.example để biết lấy ở đâu.`);
    process.exit(1);
  }
  return v;
}

function findPgDump() {
  const candidates = [
    '/opt/homebrew/opt/libpq/bin/pg_dump', // Homebrew libpq (keg-only) trên Apple Silicon
    '/usr/local/opt/libpq/bin/pg_dump',    // Homebrew libpq trên Intel Mac
    'pg_dump',                              // đã có sẵn trong PATH (Linux/VPS)
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' });
      return c;
    } catch (e) { /* thử candidate kế tiếp */ }
  }
  console.error('[backup] Không tìm thấy pg_dump. Cài: brew install libpq');
  process.exit(1);
}

async function backupDatabase(dbUrl, stamp) {
  const pgDump = findPgDump();
  const outFile = path.join(BACKUP_DIR, `db-dump-${stamp}.sql`);
  console.log('[backup] Đang pg_dump toàn bộ database (schema + data)...');
  // --no-owner --no-privileges: để restore vào Postgres VPS (user/role khác) không bị lỗi quyền.
  execFileSync(pgDump, [dbUrl, '--no-owner', '--no-privileges', '--format=plain', '--file', outFile], {
    stdio: ['ignore', 'ignore', 'inherit'], // chỉ cho stderr thật ra màn hình để thấy lỗi, ẩn stdout (không có gì nhạy cảm nhưng gọn log)
  });
  const size = fs.statSync(outFile).size;
  if (size < 100) { // lỗi im lặng kiểu "video 1MB cho 19 phút" — file dump rỗng/gần rỗng là dấu hiệu hỏng
    console.error(`[backup] CẢNH BÁO: file dump chỉ ${size} byte — có thể đã lỗi. Kiểm tra lại SUPABASE_DATABASE_URL.`);
    process.exit(1);
  }
  console.log(`[backup] OK: ${outFile} (${(size / 1024).toFixed(1)} KB)`);
  return outFile;
}

async function backupStorage(supabaseUrl, serviceKey, bucket, stamp) {
  const supabase = createClient(supabaseUrl, serviceKey);
  const destRoot = path.join(BACKUP_DIR, 'storage', stamp);
  fs.mkdirSync(destRoot, { recursive: true });

  console.log(`[backup] Đang liệt kê toàn bộ file trong bucket "${bucket}"...`);

  // Supabase Storage list() chỉ trả về 1 cấp thư mục mỗi lần — đệ quy qua các "folder" (prefix).
  async function listAllRecursive(prefix) {
    let all = [];
    let offset = 0;
    const limit = 1000;
    while (true) {
      const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit, offset });
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const item of data) {
        const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id === null) { // id null = đây là 1 "thư mục" (prefix), không phải file thật
          all = all.concat(await listAllRecursive(fullPath));
        } else {
          all.push({ path: fullPath, size: item.metadata?.size ?? null });
        }
      }
      if (data.length < limit) break;
      offset += limit;
    }
    return all;
  }

  const files = await listAllRecursive('');
  console.log(`[backup] Tìm thấy ${files.length} file — bắt đầu tải về...`);

  let okCount = 0, failCount = 0, totalBytes = 0;
  const manifest = [];
  for (const f of files) {
    const { data, error } = await supabase.storage.from(bucket).download(f.path);
    if (error) {
      console.error(`[backup]   LỖI tải "${f.path}": ${error.message}`);
      failCount++;
      manifest.push({ ...f, status: 'failed', error: error.message });
      continue;
    }
    const buf = Buffer.from(await data.arrayBuffer());
    const destPath = path.join(destRoot, f.path);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buf);
    // Đọc lại kích thước trên đĩa, so với kích thước Supabase báo — đúng nguyên tắc
    // "sau khi tải lên/xuống, đo lại kích thước" thay vì tin HTTP 200 là xong.
    const diskSize = fs.statSync(destPath).size;
    if (f.size != null && diskSize !== f.size) {
      console.error(`[backup]   CẢNH BÁO kích thước lệch "${f.path}": Supabase báo ${f.size}, tải về ${diskSize}`);
    }
    okCount++;
    totalBytes += diskSize;
    manifest.push({ ...f, status: 'ok', downloadedBytes: diskSize });
    if (okCount % 20 === 0) console.log(`[backup]   ...${okCount}/${files.length}`);
  }

  fs.writeFileSync(path.join(destRoot, '_manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[backup] Storage xong: ${okCount} OK, ${failCount} lỗi, tổng ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
  if (failCount > 0) {
    console.error('[backup] CÓ FILE TẢI LỖI — xem _manifest.json, đừng coi backup này là 100% cho tới khi failCount = 0.');
    process.exitCode = 1;
  }
  return { destRoot, okCount, failCount, totalBytes };
}

async function main() {
  const env = loadEnv(ENV_PATH);
  const dbUrl = requireVar(env, 'SUPABASE_DATABASE_URL');
  const supabaseUrl = requireVar(env, 'SUPABASE_URL');
  const serviceKey = requireVar(env, 'SUPABASE_SERVICE_ROLE_KEY');
  const bucket = env.SUPABASE_STORAGE_BUCKET || 'ceo-site';

  console.log(`[backup] Đã nạp .env OK (SUPABASE_DATABASE_URL: ${dbUrl.length} ký tự, SUPABASE_URL: ${supabaseUrl})`);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  const dbFile = await backupDatabase(dbUrl, stamp);
  const storageResult = await backupStorage(supabaseUrl, serviceKey, bucket, stamp);

  console.log('\n========== TỔNG KẾT ==========');
  console.log('Database dump :', dbFile);
  console.log('Storage folder:', storageResult.destRoot);
  console.log('Storage files :', storageResult.okCount, 'OK /', storageResult.failCount, 'lỗi');
  console.log('===============================');
  if (storageResult.failCount === 0) {
    console.log('[backup] XONG — backup 100%, có thể dùng để restore sang VPS.');
  }
}

main().catch(err => {
  console.error('[backup] LỖI KHÔNG MONG MUỐN:', err.message);
  process.exit(1);
});
