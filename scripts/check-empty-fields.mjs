// 檢查「內容後台的選填欄位留空」不會讓網站建置失敗（2026-10-16 早鳥截止日留空曾導致建置失敗、網站停止更新）
// 依 public/cms/config.yml 為每個集合產生一筆測試內容，選填欄位分別為：A 空字串（布林全勾）、B null、C 省略，各建置一次
// 用法：npm run check:empty-fields（GitHub Actions「自動化測試」也會執行）。結束後一定還原測試內容與 site.json
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import YAML from 'yaml';

const cfg = YAML.parse(readFileSync('public/cms/config.yml', 'utf8'));
const created = [];
const backups = new Map();

const dummy = (f) => {
  switch (f.widget) {
    case 'number': return f.name === 'capacity' ? 12 : f.name === 'price' ? 1000 : 1;
    case 'boolean': return true;
    case 'datetime': return '2026-01-01';
    case 'select': return f.options[0].value ?? f.options[0];
    case 'relation':
      if (f.collection === 'categories') return f.value_field === 'title' ? '學期班（11509學期）' : 'semester-11509';
      if (f.collection === 'policies') return f.filters?.[0]?.values?.[0] === '退費辦法' ? 'refund-semester' : 'makeup-semester';
      return 'x';
    case 'uuid': return `s-emptycheck${Math.random().toString(36).slice(2, 12)}`;
    case 'image': case 'file': return f.multiple ? ['/images/old/logo2.png'] : '/images/old/logo2.png';
    default: return '空白欄位檢查';
  }
};
const emptyFor = (f, v) => {
  if (v === 'C') return undefined;
  if (f.widget === 'boolean') return v === 'A' ? true : null;
  if ((f.widget === 'image' && f.multiple) || f.widget === 'list') return v === 'A' ? [] : null;
  return v === 'A' ? '' : null;
};
const build = (fields, v) => {
  const o = {};
  for (const f of fields) {
    if (f.name === 'body') continue;
    if (f.widget === 'list' && f.fields) { o[f.name] = [build(f.fields, v)]; continue; }
    if (f.required === false) { const e = emptyFor(f, v); if (e !== undefined) o[f.name] = e; }
    else o[f.name] = dummy(f);
  }
  return o;
};
const write = (path, content) => {
  if (existsSync(path) && !backups.has(path)) backups.set(path, readFileSync(path));
  if (!existsSync(path)) created.push(path);
  writeFileSync(path, content);
};
const cleanup = () => {
  for (const p of created.splice(0)) rmSync(p, { force: true });
  for (const [p, b] of backups) writeFileSync(p, b);
  backups.clear();
};

let failed = false;
try {
  for (const v of ['A', 'B', 'C']) {
    for (const col of cfg.collections) {
      if (col.files) {
        for (const file of col.files) write(file.file, `${JSON.stringify(build(file.fields, v), null, 2)}\n`);
        continue;
      }
      const data = build(col.fields, v);
      const needsBody = col.fields.some((f) => f.name === 'body' && f.required !== false);
      write(`${col.folder}/zz-empty-check-${v}.md`, `---\n${YAML.stringify(data)}---\n${needsBody ? '\n空白欄位檢查\n' : ''}`);
      if (col.name === 'courses' && v !== 'C') {
        write(`${col.folder}/zz-empty-check-${v}-2.md`, `---\n${YAML.stringify({ ...data, sessions: v === 'A' ? [] : null })}---\n`);
      }
    }
    rmSync('.astro', { recursive: true, force: true });
    rmSync('node_modules/.astro', { recursive: true, force: true });
    try {
      execSync('npm run build', { stdio: 'pipe' });
      console.log(`✅ 變體 ${v}（選填欄位${{ A: '空字串', B: 'null', C: '省略' }[v]}）：建置成功`);
    } catch (err) {
      failed = true;
      console.error(`❌ 變體 ${v}（選填欄位${{ A: '空字串', B: 'null', C: '省略' }[v]}）：建置失敗`);
      console.error(String(err.stdout ?? '').split('\n').filter((l) => /Error|Expected|received|→|zz-empty-check/.test(l)).slice(0, 15).join('\n'));
    }
    cleanup();
  }
} finally {
  cleanup();
}
process.exit(failed ? 1 : 0);
