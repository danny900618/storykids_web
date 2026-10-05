// Email（Brevo）：正式模式送出內容、寄送失敗不影響報名、測試模式不寄出、後台寄測試信
// 不會真的呼叫 Brevo：攔截 fetch 回傳假結果
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAddress } from '../src/worker/notify';
import { adminRequest, call, db, register, registerRequest, resetDb, validRegistration } from './helpers';

const live = { MAIL_MODE: 'live', BREVO_API_KEY: 'test-brevo-key', MAIL_FROM: '故事講堂 <service@storykids.com.tw>' };

let brevoCalls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
let brevoStatus = 201;

beforeEach(async () => {
  await resetDb();
  brevoCalls = [];
  brevoStatus = 201;
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith('https://api.brevo.com/')) {
      brevoCalls.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return new Response(brevoStatus < 300 ? '{"messageId":"x"}' : '{"message":"sender not valid"}', { status: brevoStatus });
    }
    return realFetch(input, init);
  });
});

afterEach(() => vi.restoreAllMocks());

describe('Email 寄送', () => {
  it('解析寄件人格式', () => {
    expect(parseAddress('故事講堂 <service@storykids.com.tw>')).toEqual({ name: '故事講堂', email: 'service@storykids.com.tw' });
    expect(parseAddress('a@b.com')).toEqual({ email: 'a@b.com' });
  });

  it('測試模式（mock）不會呼叫 Brevo', async () => {
    await register('two-seats');
    expect(brevoCalls).toHaveLength(0);
  });

  it('正式模式：寄件人為「故事講堂 <service@storykids.com.tw>」，寄給家長與公司信箱', async () => {
    const data = validRegistration('two-seats');
    const res = await call(registerRequest(data), live);
    expect(res.status).toBe(200);
    expect(brevoCalls).toHaveLength(2);
    const parent = brevoCalls.find((c) => (c.body.to as { email: string }[])[0].email === data.email)!;
    expect(parent.headers.get('api-key')).toBe('test-brevo-key');
    expect(parent.body.sender).toEqual({ name: '故事講堂', email: 'service@storykids.com.tw' });
    expect(String(parent.body.subject)).toContain('報名成功');
    expect(String(parent.body.textContent)).toContain('96989');
    expect(brevoCalls.some((c) => (c.body.to as { email: string }[])[0].email === 'office@example.com')).toBe(true);
    const { results } = await db().prepare(`SELECT result FROM notifications WHERE channel = 'email'`).all<{ result: string }>();
    expect(results.every((r) => r.result === 'sent')).toBe(true);
  });

  it('Brevo 寄送失敗：報名照常成功，通知紀錄標示失敗原因', async () => {
    brevoStatus = 400;
    const res = await call(registerRequest(validRegistration('two-seats')), live);
    expect(res.status).toBe(200);
    const row = await db().prepare(`SELECT result, body FROM notifications WHERE channel = 'email' LIMIT 1`).first<{ result: string; body: string }>();
    expect(row!.result).toBe('failed');
    expect(row!.body).toContain('寄送失敗');
    expect(row!.body).not.toContain('test-brevo-key');
  });
});

describe('後台寄測試信', () => {
  const send = (to: unknown, overrides = {}) =>
    call(adminRequest('/api/admin/test-email', { method: 'POST', body: JSON.stringify({ to }) }), overrides);

  it('寄出一封測試信', async () => {
    const res = await send('me@example.com', live);
    expect(res.status).toBe(200);
    expect(brevoCalls).toHaveLength(1);
    expect((brevoCalls[0].body.to as { email: string }[])[0].email).toBe('me@example.com');
  });

  it('可以指定寄件人（網域驗證前用自己驗證過的信箱）', async () => {
    const res = await call(
      adminRequest('/api/admin/test-email', { method: 'POST', body: JSON.stringify({ to: 'me@example.com', from: '故事講堂測試 <me@gmail.com>' }) }),
      live,
    );
    expect(res.status).toBe(200);
    expect(brevoCalls[0].body.sender).toEqual({ name: '故事講堂測試', email: 'me@gmail.com' });
  });

  it('預覽某一封通知信：寄出跟家長收到的同一份內容', async () => {
    const { body: reg } = await register('two-seats');
    const n = await db().prepare(`SELECT id, subject FROM notifications WHERE registration_id = ? AND channel = 'email' AND subject LIKE '%報名成功%'`).bind(reg.id).first<{ id: number; subject: string }>();
    const res = await call(
      adminRequest('/api/admin/test-email', { method: 'POST', body: JSON.stringify({ to: 'me@example.com', notification_id: n!.id }) }),
      live,
    );
    expect(res.status).toBe(200);
    expect(String(brevoCalls[0].body.subject)).toBe(`［預覽］${n!.subject}`);
    expect(String(brevoCalls[0].body.textContent)).toContain(reg.va_account!);
  });

  it('寄件人格式錯誤被拒絕', async () => {
    const res = await call(adminRequest('/api/admin/test-email', { method: 'POST', body: JSON.stringify({ to: 'me@example.com', from: 'not-an-email' }) }), live);
    expect(res.status).toBe(400);
  });

  it('Email 格式錯誤被拒絕', async () => {
    expect((await send('not-an-email', live)).status).toBe(400);
  });

  it('沒有設定 API 金鑰時回傳錯誤', async () => {
    const res = await send('me@example.com', { BREVO_API_KEY: undefined });
    expect(res.status).toBe(502);
  });

  it('需要登入才能寄測試信', async () => {
    const res = await call(new Request('https://storykids-web.example.workers.dev/api/admin/test-email', { method: 'POST', body: '{}' }), live);
    expect(res.status).toBe(401);
    expect(brevoCalls).toHaveLength(0);
  });
});
