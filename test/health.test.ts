// 系統健康檢查：各項檢查、警告信（不論 MAIL_MODE 都寄）、同一問題 24 小時內只寄一次、排程進入點、後台 API
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/worker/index';
import { checkHealth, runHealthCheck } from '../src/worker/health';
import { adminRequest, baseEnv, call, db, resetDb } from './helpers';

const now = () => new Date().toISOString();
const addNotification = (channel: string, result: string, body = 'x') =>
  db().prepare(`INSERT INTO notifications (channel, recipient, subject, body, result, created_at) VALUES (?, 'r', 's', ?, ?, ?)`).bind(channel, body, result, now()).run();

let brevo: { to: string; from: string; subject: string }[] = [];
let relayUp = true;

beforeEach(async () => {
  await resetDb();
  brevo = [];
  relayUp = true;
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'api.brevo.com') {
      const b = JSON.parse(String(init?.body));
      brevo.push({ to: b.to[0].email, from: b.sender.email, subject: b.subject });
      return Response.json({ messageId: 'm' }, { status: 201 });
    }
    if (url.hostname === 'sms-relay.example.com') return relayUp ? new Response('ok') : new Response('', { status: 502 });
    return realFetch(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

const env = (overrides = {}) => ({
  ...baseEnv(),
  BREVO_API_KEY: 'k',
  HEALTH_ALERT_TO: 'dev@example.com,school@example.com',
  HEALTH_ALERT_FROM: '故事講堂系統通知 <verified@example.com>',
  ...overrides,
});

describe('系統健康檢查', () => {
  it('沒有問題時不回報、不寄信', async () => {
    expect(await checkHealth(env())).toEqual([]);
    expect((await runHealthCheck(env())).alerted).toEqual([]);
    expect(brevo).toHaveLength(0);
  });

  it('偵測：Email 接近每日上限、寄送失敗、三竹點數不足、銷帳檔無法辨識、需人工確認', async () => {
    await db().batch(Array.from({ length: 250 }, () => db().prepare(`INSERT INTO notifications (channel, recipient, body, result, created_at) VALUES ('email', 'r', 'x', 'sent', ?)`).bind(now())));
    await addNotification('sms', 'failed');
    await addNotification('sms', 'sent', '簡訊內容\n［三竹剩餘點數 120］');
    await db().prepare(`INSERT INTO bank_files (filename, sha256, size, content_b64, received_at, status) VALUES ('a', 'h', 1, 'eA==', ?, 'failed')`).bind(now()).run();
    const keys = (await checkHealth(env())).map((i) => i.key).sort();
    expect(keys).toEqual(['bank_files', 'email_quota', 'send_failures', 'sms_points']);
  });

  it('轉發主機沒有回應時回報；直連三竹時不檢查', async () => {
    const relay = { MITAKE_API_URL: 'https://sms-relay.example.com/api/mtk/SmSend', SMS_RELAY_KEY: 'x'.repeat(64) };
    expect(await checkHealth(env(relay))).toEqual([]);
    relayUp = false;
    expect((await checkHealth(env(relay))).map((i) => i.key)).toEqual(['relay']);
    expect(await checkHealth(env({ MITAKE_API_URL: 'https://smsapi.mitake.com.tw/api/mtk/SmSend', SMS_RELAY_KEY: 'x' }))).toEqual([]);
  });

  it('寄警告給所有收件人（即使 MAIL_MODE 為 mock），同一問題 24 小時內不重複寄', async () => {
    await addNotification('email', 'failed');
    const first = await runHealthCheck(env({ MAIL_MODE: 'mock' }));
    expect(first.alerted).toEqual(['send_failures']);
    expect(brevo.map((b) => b.to).sort()).toEqual(['dev@example.com', 'school@example.com']);
    expect(brevo[0].from).toBe('verified@example.com');
    expect(brevo[0].subject).toContain('系統警告');

    const second = await runHealthCheck(env());
    expect(second.issues).toHaveLength(1);
    expect(second.alerted).toEqual([]);
    expect(brevo).toHaveLength(2);

    // 超過 24 小時再寄
    await db().prepare(`UPDATE health_alerts SET last_alert_at = '2000-01-01T00:00:00.000Z'`).run();
    expect((await runHealthCheck(env())).alerted).toEqual(['send_failures']);
  });

  it('排程進入點會執行健康檢查', async () => {
    await addNotification('email', 'failed');
    const ctx = createExecutionContext();
    await worker.scheduled!(createScheduledController({ cron: '0 * * * *' }), env(), ctx);
    await waitOnExecutionContext(ctx);
    expect(brevo.length).toBeGreaterThan(0);
  });

  it('後台可查看目前的問題（需要登入）', async () => {
    await addNotification('sms', 'failed');
    expect((await call(new Request('https://storykids-web.example.workers.dev/api/admin/health'))).status).toBe(401);
    const { issues } = (await (await call(adminRequest('/api/admin/health'))).json()) as { issues: { key: string }[] };
    expect(issues.map((i) => i.key)).toContain('send_failures');
    expect(brevo).toHaveLength(0);
  });
});
