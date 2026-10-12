// 匯入舊站報名資料：把舊站後台匯出的「課程報名-梯次.xls」轉成 SQL，再用 wrangler 寫進 D1
//
// 用法：
//   node scripts/import-legacy.mjs <xls 檔或資料夾> [輸出的 .sql 路徑]
//   npx wrangler d1 execute storykids --local  --file <輸出的 .sql>   # 本機
//   npx wrangler d1 execute storykids --remote --file <輸出的 .sql>   # 線上
//
// ⚠️ xls 與產生的 .sql 都含個資：放在 repo 以外或 old_class/（已列入 .gitignore），用完即刪，絕不 commit。
// 同一份檔案重複匯入不會產生重複資料（梯次 + 舊站編號為唯一鍵，INSERT OR IGNORE）。
// 舊站資料沒有報名時間與金額：報名時間以上課期間的開始日代替（排序用，後台顯示為「舊站 梯次」），金額記為 0。
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import * as XLSX from 'xlsx';

const [input, output = join(tmpdir(), `storykids-legacy-${Date.now()}.sql`)] = process.argv.slice(2);
if (!input) {
  console.error('用法：node scripts/import-legacy.mjs <xls 檔或資料夾> [輸出的 .sql 路徑]');
  process.exit(1);
}

// 舊站匯出的欄位順序
const HEADER = ['編號', '課程主題', '上課日期', '虛擬帳號', '學生姓名', '就讀學校', '目前就讀年級', '家長姓名', '聯絡電話', '行動電話', '郵遞區號', '地址', '電子信箱', '飲食習慣', '性別', '學生狀況說明', '狀態'];
const STATUSES = ['待處理', '等待付費', '已付訂金', '已付費', '合庫轉帳', '現金繳清', '轉至其他梯次', '取消報名'];

const files = statSync(input).isDirectory()
  ? readdirSync(input).filter((f) => /\.xlsx?$/i.test(f)).map((f) => join(input, f))
  : [input];

const sql = (v) => (v === null || v === undefined || v === '' ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const text = (v) => String(v ?? '').trim();
const now = new Date().toISOString();

const rows = [];
const warnings = [];
for (const file of files) {
  // 梯次取自檔名：「課程報名-11509學期.xls」→「11509學期」
  const term = basename(file).replace(/\.xlsx?$/i, '').replace(/^課程報名-/, '');
  const wb = XLSX.read(readFileSync(file));
  const sheet = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
  const header = sheet[0].slice(0, HEADER.length).map(text);
  if (header.join() !== HEADER.join()) throw new Error(`${basename(file)} 的欄位與預期不同：${header.join('、')}`);

  let count = 0;
  for (const r of sheet.slice(1)) {
    if (!r.some((c) => text(c))) continue; // 空白列
    const [id, course, date, va, student, school, grade, parent, tel, mobile, zip, address, email, diet, gender, note, status] = r.map(text);
    const legacyId = Number(id);
    if (!Number.isInteger(legacyId)) {
      warnings.push(`${term}：略過編號不正確的一列`);
      continue;
    }
    if (!STATUSES.includes(status)) warnings.push(`${term} #${legacyId}：狀態「${status}」不在新系統的狀態清單中`);
    const sessionName = date || '（未填上課日期）';
    const start = date.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    rows.push({
      session_code: `old-${createHash('sha1').update(`${term}|${course}|${sessionName}`).digest('hex').slice(0, 10)}`,
      course_id: 'legacy',
      course_title: course,
      session_name: sessionName,
      student_name: student,
      parent_name: parent,
      school,
      grade,
      phone: mobile.replace(/[\s-]/g, ''),
      email,
      note,
      gender,
      tel,
      zip,
      address,
      diet,
      admission: '正取',
      status,
      amount: 0,
      legacy_id: legacyId,
      legacy_term: term,
      legacy_va: va,
      created_at: start ? new Date(`${start}T00:00:00+08:00`).toISOString() : now,
      updated_at: now,
    });
    count++;
  }
  console.log(`${term}：${count} 筆`);
}

// 依上課日期由舊到新寫入，報名編號（id）順序與時間一致
rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.legacy_term.localeCompare(b.legacy_term) || a.legacy_id - b.legacy_id);
const cols = Object.keys(rows[0] ?? {});
const statements = rows.map((r) => `INSERT OR IGNORE INTO registrations (${cols.join(', ')}) VALUES (${cols.map((c) => sql(r[c])).join(', ')});`);
statements.push(
  `INSERT INTO audit_log (registration_id, actor, action, detail, created_at) VALUES (NULL, 'system', '匯入舊站資料', ${sql(`${files.length} 個檔案、${rows.length} 筆（重複的會略過）`)}, ${sql(now)});`,
);
writeFileSync(output, `${statements.join('\n')}\n`);

for (const w of warnings) console.warn(`⚠️ ${w}`);
console.log(`\n共 ${rows.length} 筆，SQL 已寫到：${output}`);
console.log('⚠️ 這個檔案含個資，匯入後請刪除。');
