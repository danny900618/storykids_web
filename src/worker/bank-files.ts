// 台新銷帳檔：台新以 sFTP 上傳到轉發主機（relay/），主機轉交到 POST /api/taishin/file
// 先完整保存原始檔案（D1 bank_files），再逐筆解析（taishin.ts）並對帳：轉入 → reconcile()；沖正 → recordReversal()
import type { Env } from './env';
import { json, nowIso } from './env';
import { timingSafeEqual } from './auth';
import { parseSettlementFile } from './taishin';
import { reconcile, recordReversal } from './payment';

const MAX_SIZE = 5 * 1024 * 1024; // 單一銷帳檔上限 5 MB

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// POST /api/taishin/file：轉發主機轉交的銷帳檔（需 X-Relay-Key = TAISHIN_FILE_KEY）
export async function handleBankFile(request: Request, env: Env): Promise<Response> {
  // 沒有設定密鑰時一律拒絕（fail closed）
  if (!env.TAISHIN_FILE_KEY) return json({ error: '尚未設定' }, 403);
  const key = request.headers.get('X-Relay-Key') ?? '';
  if (!(await timingSafeEqual(key, env.TAISHIN_FILE_KEY))) return json({ error: '驗證失敗' }, 403);

  // 檔名只保留安全字元（只做紀錄用）
  const filename = (request.headers.get('X-Filename') ?? '').replace(/[^\w.\-]/g, '_').slice(0, 200) || 'unnamed';
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) return json({ error: '空檔案' }, 400);
  if (bytes.length > MAX_SIZE) return json({ error: '檔案過大' }, 413);

  const sha256 = toHex(await crypto.subtle.digest('SHA-256', bytes));
  const result = await env.DB.prepare(
    `INSERT INTO bank_files (filename, sha256, size, content_b64, received_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (sha256) DO NOTHING RETURNING id`,
  )
    .bind(filename, sha256, bytes.length, toBase64(bytes), nowIso())
    .first<{ id: number }>();

  // 同一份檔案重送（台新補檔、轉交重試）：回成功，讓轉發主機把檔案移出待處理資料夾
  if (!result) return json({ ok: true, duplicate: true, sha256 });

  await env.DB.prepare(`INSERT INTO audit_log (registration_id, actor, action, detail, created_at) VALUES (NULL, 'system', '收到銷帳檔', ?, ?)`)
    .bind(`${filename}（${bytes.length} bytes，#${result.id}）`, nowIso())
    .run();
  const summary = await processBankFile(env, result.id, bytes);
  return json({ ok: true, id: result.id, sha256, ...summary });
}

const RESULT_LABELS: Record<string, string> = {
  paid: '對帳成功',
  paid_late: '逾期入帳',
  amount_mismatch: '金額不符',
  unmatched: '查無帳號',
  already_paid: '重複繳費',
  not_payable: '報名非正取或已取消',
  legacy: '舊站帳號',
  reversal: '銀行沖正',
  duplicate_event: '已處理過',
};

// 解析並逐筆對帳；同一筆交易（ref 相同）重送不會重複入帳。解析失敗的行記在 note，檔案狀態為 failed 方便人工查看
export async function processBankFile(env: Env, id: number, bytes: Uint8Array): Promise<{ records: number; counts: Record<string, number> }> {
  const { records, errors } = parseSettlementFile(bytes);
  const counts: Record<string, number> = {};
  for (const r of records) {
    const input = { ref: r.ref, vaAccount: r.va, amount: r.amount, raw: r.line };
    const outcome = r.sign === '+' ? (await reconcile(env, input)).result : await recordReversal(env, input);
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  }
  const parts = Object.entries(counts).map(([k, n]) => `${RESULT_LABELS[k] ?? k} ${n}`);
  const note = [`共 ${records.length} 筆${parts.length ? `：${parts.join('、')}` : ''}`, ...errors.slice(0, 20)].join('；');
  await env.DB.prepare('UPDATE bank_files SET status = ?, note = ?, processed_at = ? WHERE id = ?')
    .bind(errors.length ? 'failed' : 'parsed', note, nowIso(), id)
    .run();
  return { records: records.length, counts };
}
