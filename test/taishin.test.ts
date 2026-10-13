// 台新虛擬帳號（公式 5）與銷帳檔對帳
import { beforeEach, describe, expect, it } from 'vitest';
import { checkDigit, dueDateCode, buildVirtualAccount, isValidVirtualAccount, parseSettlementFile } from '../src/worker/taishin';
import { ORIGIN, call, db, getRegistration, register, resetDb } from './helpers';

const KEY = 'f'.repeat(64);
const live = { PAYMENT_MODE: 'live', TAISHIN_FILE_KEY: KEY };
const enc = (s: string) => new TextEncoder().encode(s);
// 固定欄位：序號 10、日期 10、金額 15（右靠補 0）、帳號 20、交易代號 4、正負 16、備註 40
const line = (serial: number, date: string, amount: number, va: string, sign = '+', tx = 'ATM', bank = '812') =>
  String(serial).padStart(6, '0').padEnd(10) + date.padEnd(10) + String(amount).padStart(15, '0') + va.padEnd(20) + tx.padEnd(4) + sign.padEnd(16) + bank.padEnd(40);
const sendFile = (content: string, name = 'TS.txt') =>
  call(new Request(`${ORIGIN}/api/taishin/file`, { method: 'POST', body: enc(content), headers: { 'X-Relay-Key': KEY, 'X-Filename': name } }), live);

beforeEach(resetDb);

describe('虛擬帳號（公式 5）', () => {
  it('與台新規格書範例相同：9528208924365、金額 3900 → 檢查碼 2', () => {
    expect(checkDigit('9528208924365', 3900)).toBe(2);
  });

  it('繳款截止日：民國年尾數＋年中第幾天（台灣時間）', () => {
    expect(dueDateCode('2025-12-31T15:59:59.000Z')).toBe('4365'); // 台灣 2025-12-31 23:59:59
    expect(dueDateCode('2026-01-01T00:00:00.000Z')).toBe('5001'); // 台灣 2026-01-01 08:00
    expect(dueDateCode('2026-10-30T15:59:59.000Z')).toBe('5303');
  });

  it('組成：96989＋報名編號後 4 碼＋截止日 4 碼＋檢查碼，共 14 碼', () => {
    const va = buildVirtualAccount(12345, '2026-10-30T15:59:59.000Z', 11000);
    expect(va).toMatch(/^96989\d{9}$/);
    expect(va.slice(5, 9)).toBe('2345');
    expect(va.slice(9, 13)).toBe('5303');
    expect(isValidVirtualAccount(va, 11000)).toBe(true);
    expect(isValidVirtualAccount(va, 10900)).toBe(false);
  });

  it('正式模式產生正確帳號；測試模式檢查碼故意錯誤（銀行不會收款）', async () => {
    const liveReg = (await register('two-seats', {}, live)).body;
    const row = (await getRegistration(liveReg.id))!;
    expect(isValidVirtualAccount(row.va_account!, row.amount)).toBe(true);
    const mockReg = (await register('two-seats')).body;
    const mockRow = (await getRegistration(mockReg.id))!;
    expect(mockRow.va_account).toMatch(/^96989\d{9}$/);
    expect(isValidVirtualAccount(mockRow.va_account!, mockRow.amount)).toBe(false);
  });
});

describe('銷帳檔解析', () => {
  it('固定欄位與 TAB 分隔都能解析；無法辨識的行列為錯誤', () => {
    const fixed = line(1, '2026/10/30', 11000, '96989000153036');
    const tab = ['000002', '2026/10/30', '000000000011000', '96989000253039', 'IBB', '+', '012'].join('\t');
    const { records, errors } = parseSettlementFile(enc(`${fixed}\r\n${tab}\r\nHEADER\r\n\r\n`));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ serial: '000001', date: '2026/10/30', amount: 11000, va: '96989000153036', txCode: 'ATM', sign: '+', bankCode: '812' });
    expect(records[1]).toMatchObject({ amount: 11000, txCode: 'IBB', bankCode: '012' });
    expect(errors).toEqual(['第 3 行格式無法辨識']);
  });
});

describe('銷帳檔對帳（正式模式）', () => {
  it('入帳金額正確 → 已付費並寄繳費完成通知；同一份檔案重送不會重複入帳', async () => {
    const reg = (await register('two-seats', {}, live)).body;
    const row = (await getRegistration(reg.id))!;
    const content = line(1, '2026/10/30', row.amount, row.va_account!);
    const res = await sendFile(content);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { counts: Record<string, number> }).counts).toEqual({ paid: 1 });
    expect((await getRegistration(reg.id))!.status).toBe('已付費');
    const { n } = (await db().prepare(`SELECT COUNT(*) AS n FROM notifications WHERE registration_id = ? AND subject LIKE '%繳費完成%'`).bind(reg.id).first<{ n: number }>())!;
    expect(n).toBe(1);

    // 同內容另一個檔名（例如台新補檔）：同一筆交易已處理過
    const again = await sendFile(`${content}\r\n`, 'TS-resend.txt');
    expect(((await again.json()) as { counts: Record<string, number> }).counts).toEqual({ duplicate_event: 1 });
    const file = await db().prepare('SELECT status, note FROM bank_files ORDER BY id LIMIT 1').first<{ status: string; note: string }>();
    expect(file).toMatchObject({ status: 'parsed' });
    expect(file!.note).toContain('對帳成功 1');
  });

  it('金額不符 → 需人工確認；查無帳號 → 記錄但不影響其他筆', async () => {
    const reg = (await register('two-seats', {}, live)).body;
    const row = (await getRegistration(reg.id))!;
    const res = await sendFile([line(1, '2026/10/30', row.amount - 500, row.va_account!), line(2, '2026/10/30', 3000, '96989999953030')].join('\r\n'));
    expect(((await res.json()) as { counts: Record<string, number> }).counts).toEqual({ amount_mismatch: 1, unmatched: 1 });
    const after = (await getRegistration(reg.id))!;
    expect(after.status).toBe('等待付費');
    expect(after.review_note).toContain('金額不符');
  });

  it('銀行沖正（負號）→ 不改狀態，標記需人工確認', async () => {
    const reg = (await register('two-seats', {}, live)).body;
    const row = (await getRegistration(reg.id))!;
    await sendFile(line(1, '2026/10/30', row.amount, row.va_account!));
    await sendFile(line(2, '2026/10/31', row.amount, row.va_account!, '-'));
    const after = (await getRegistration(reg.id))!;
    expect(after.status).toBe('已付費');
    expect(after.review_note).toContain('沖正');
  });

  it('轉入舊站報名的帳號 → 對應到舊站資料並標記需人工確認', async () => {
    await db().prepare(
      `INSERT INTO registrations (session_code, course_id, course_title, session_name, student_name, parent_name, phone, email,
        admission, status, amount, legacy_id, legacy_term, legacy_va, created_at, updated_at)
       VALUES ('old-a', 'legacy', '舊課程', '2026-08-24', '舊學生', '舊家長', '0911222333', 'old@example.com',
        '正取', '等待付費', 0, 7, '115夏令營', '96989416552612', '2026-08-24T00:00:00Z', '2026-08-24T00:00:00Z')`,
    ).run();
    const res = await sendFile(line(1, '2026/09/10', 8500, '96989416552612'));
    expect(((await res.json()) as { counts: Record<string, number> }).counts).toEqual({ legacy: 1 });
    const row = await db().prepare(`SELECT review_note FROM registrations WHERE legacy_va = '96989416552612'`).first<{ review_note: string }>();
    expect(row!.review_note).toContain('舊站');
  });
});
