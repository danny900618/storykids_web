// 台新銷帳檔轉交：密鑰驗證、原始檔案完整保存、重送不重複、後台列表
import { beforeEach, describe, expect, it } from 'vitest';
import { ORIGIN, adminRequest, call, db, resetDb } from './helpers';

const KEY = 'f'.repeat(64);
const withKey = { TAISHIN_FILE_KEY: KEY };
const upload = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/taishin/file`, { method: 'POST', body, headers: { 'X-Relay-Key': KEY, 'X-Filename': 'TS96989_20261030.txt', ...headers } });

beforeEach(resetDb);

describe('台新銷帳檔', () => {
  it('沒有設定密鑰時一律拒絕（fail closed）', async () => {
    expect((await call(upload('data'))).status).toBe(403);
  });

  it('密鑰錯誤或沒帶密鑰：拒絕且不保存', async () => {
    expect((await call(upload('data', { 'X-Relay-Key': 'wrong' }), withKey)).status).toBe(403);
    expect((await call(new Request(`${ORIGIN}/api/taishin/file`, { method: 'POST', body: 'data' }), withKey)).status).toBe(403);
    const { n } = (await db().prepare('SELECT COUNT(*) AS n FROM bank_files').first<{ n: number }>())!;
    expect(n).toBe(0);
  });

  it('完整保存原始位元組（例如 Big5 編碼），並記錄操作紀錄', async () => {
    const bytes = new Uint8Array([0xa5, 0x78, 0xb7, 0x73, 0x0d, 0x0a, 0x39, 0x36, 0x39, 0x38, 0x39]); // 「台新」Big5 + 換行 + 96989
    const res = await call(upload(bytes), withKey);
    expect(res.status).toBe(200);
    const row = await db().prepare('SELECT filename, size, content_b64, status FROM bank_files').first<{ filename: string; size: number; content_b64: string; status: string }>();
    expect(row).toMatchObject({ filename: 'TS96989_20261030.txt', size: bytes.length, status: 'pending' });
    expect([...Uint8Array.from(atob(row!.content_b64), (c) => c.charCodeAt(0))]).toEqual([...bytes]);
    const audit = await db().prepare(`SELECT detail FROM audit_log WHERE action = '收到銷帳檔'`).first<{ detail: string }>();
    expect(audit!.detail).toContain('TS96989_20261030.txt');
  });

  it('同一份檔案重送（補檔或轉交重試）只保存一次，仍回成功', async () => {
    expect((await call(upload('same content'), withKey)).status).toBe(200);
    const again = await call(upload('same content'), withKey);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { duplicate?: boolean }).duplicate).toBe(true);
    const { n } = (await db().prepare('SELECT COUNT(*) AS n FROM bank_files').first<{ n: number }>())!;
    expect(n).toBe(1);
  });

  it('檔名中的路徑與特殊字元會被清除；空檔案拒絕', async () => {
    await call(upload('x', { 'X-Filename': '../../etc/passwd' }), withKey);
    const row = await db().prepare('SELECT filename FROM bank_files').first<{ filename: string }>();
    expect(row!.filename).not.toContain('/');
    expect((await call(upload(''), withKey)).status).toBe(400);
  });

  it('後台可查看收檔列表（不含檔案內容），需要登入', async () => {
    await call(upload('abc'), withKey);
    expect((await call(new Request(`${ORIGIN}/api/admin/bank-files`))).status).toBe(401);
    const { items } = (await (await call(adminRequest('/api/admin/bank-files'))).json()) as { items: Record<string, unknown>[] };
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty('content_b64');
  });
});
