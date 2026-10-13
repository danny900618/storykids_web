// 三竹簡訊：正式模式送出參數、成功／失敗判斷、剩餘點數、發送失敗不影響報名、後台發測試簡訊
// 不會真的呼叫三竹：攔截 fetch 回傳假結果
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminRequest, call, db, registerRequest, resetDb, validRegistration } from './helpers';

const live = { SMS_MODE: 'live', MITAKE_USERNAME: 'test-user', MITAKE_PASSWORD: 'test-pass', MITAKE_API_URL: 'https://smsapi.mitake.com.tw/api/mtk/SmSend' };

let calls: { url: URL; form: URLSearchParams; headers: Headers }[] = [];
let relayStatus = 200;
let reply = '[1]\r\nmsgid=1234567890\r\nstatuscode=1\r\nAccountPoint=987\r\n';

beforeEach(async () => {
  await resetDb();
  calls = [];
  reply = '[1]\r\nmsgid=1234567890\r\nstatuscode=1\r\nAccountPoint=987\r\n';
  relayStatus = 200;
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname.endsWith('mitake.com.tw') || url.hostname === 'sms-relay.example.com') {
      calls.push({ url, form: new URLSearchParams(String(init?.body)), headers: new Headers(init?.headers) });
      if (url.hostname === 'sms-relay.example.com' && relayStatus !== 200) return new Response('', { status: relayStatus });
      return new Response(reply);
    }
    return realFetch(input, init);
  });
});

afterEach(() => vi.restoreAllMocks());

describe('三竹簡訊', () => {
  it('測試模式（mock）不會呼叫三竹', async () => {
    await call(registerRequest(validRegistration('two-seats')));
    expect(calls).toHaveLength(0);
  });

  it('正式模式：帶入帳號、手機、內容與 UTF-8 參數，並記錄剩餘點數', async () => {
    const data = validRegistration('two-seats');
    expect((await call(registerRequest(data), live)).status).toBe(200);
    expect(calls).toHaveLength(1);
    const { url, form } = calls[0];
    expect(url.searchParams.get('CharsetURL')).toBe('UTF8');
    expect(form.get('username')).toBe('test-user');
    expect(form.get('dstaddr')).toBe(data.phone);
    expect(form.get('smbody')).toContain('故事講堂');
    expect(form.get('clientid')!.length).toBeLessThanOrEqual(36);
    const row = await db().prepare(`SELECT result, body FROM notifications WHERE channel = 'sms'`).first<{ result: string; body: string }>();
    expect(row!.result).toBe('sent');
    expect(row!.body).toContain('三竹剩餘點數 987');
  });

  it('三竹回傳錯誤碼：報名照常成功，紀錄標示失敗且不含密碼', async () => {
    reply = '[1]\r\nstatuscode=e\r\nError=帳號或密碼錯誤\r\n';
    expect((await call(registerRequest(validRegistration('two-seats')), live)).status).toBe(200);
    const row = await db().prepare(`SELECT result, body FROM notifications WHERE channel = 'sms'`).first<{ result: string; body: string }>();
    expect(row!.result).toBe('failed');
    expect(row!.body).toContain('statuscode=e');
    expect(row!.body).not.toContain('test-pass');
  });

  it('後台顯示最近一次回報的剩餘點數', async () => {
    await call(registerRequest(validRegistration('two-seats')), live);
    const config = (await (await call(adminRequest('/api/admin/config'), live)).json()) as { sms_points: number | null };
    expect(config.sms_points).toBe(987);
  });
});

describe('經由固定 IP 轉發主機發送（AWS Lightsail）', () => {
  const relay = { ...live, MITAKE_API_URL: 'https://sms-relay.example.com/api/mtk/SmSend', SMS_RELAY_KEY: 'k'.repeat(64) };

  it('送到轉發主機並帶上密鑰，參數與直連三竹相同', async () => {
    expect((await call(registerRequest(validRegistration('two-seats')), relay)).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.hostname).toBe('sms-relay.example.com');
    expect(calls[0].url.pathname).toBe('/api/mtk/SmSend');
    expect(calls[0].url.searchParams.get('CharsetURL')).toBe('UTF8');
    expect(calls[0].headers.get('X-Relay-Key')).toBe('k'.repeat(64));
    expect(calls[0].form.get('username')).toBe('test-user');
  });

  it('直連三竹時不帶轉發密鑰', async () => {
    await call(registerRequest(validRegistration('two-seats')), live);
    expect(calls[0].headers.get('X-Relay-Key')).toBeNull();
  });

  it('轉發主機拒絕（密鑰不符）：報名照常成功，紀錄寫明是轉發主機的問題', async () => {
    relayStatus = 404;
    expect((await call(registerRequest(validRegistration('two-seats')), relay)).status).toBe(200);
    const row = await db().prepare(`SELECT result, body FROM notifications WHERE channel = 'sms'`).first<{ result: string; body: string }>();
    expect(row!.result).toBe('failed');
    expect(row!.body).toContain('轉發主機拒絕');
    expect(row!.body).not.toContain('k'.repeat(64));
  });
});

describe('後台發測試簡訊', () => {
  const send = (to: unknown, overrides = {}) => call(adminRequest('/api/admin/test-sms', { method: 'POST', body: JSON.stringify({ to }) }), overrides);

  it('發送成功並回傳剩餘點數', async () => {
    const res = await send('0912345678', live);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { account_point: number }).account_point).toBe(987);
    expect(calls[0].form.get('dstaddr')).toBe('0912345678');
  });

  it('手機格式錯誤被拒絕，不會呼叫三竹', async () => {
    expect((await send('12345', live)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('沒有設定帳號密碼時回傳錯誤', async () => {
    expect((await send('0912345678', { MITAKE_USERNAME: undefined, MITAKE_PASSWORD: undefined })).status).toBe(502);
  });
});
