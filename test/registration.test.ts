// 報名：名額、候補、驗證、防竄改、併發、次數限制、正式網域保護
import { beforeEach, describe, expect, it } from 'vitest';
import { call, db, getRegistration, nextIp, register, registerRequest, resetDb, validRegistration, ORIGIN } from './helpers';

const availability = async () => (await (await call(new Request(`${ORIGIN}/api/availability`))).json()) as Record<string, { remaining: number; waitlist: number }>;

beforeEach(resetDb);

describe('名額與候補', () => {
  it('名額內為正取並產生繳費帳號，額滿後為候補且不產生帳號', async () => {
    const first = await register('one-seat');
    expect(first.res.status).toBe(200);
    expect(first.body.admission).toBe('正取');
    expect(first.body.va_account).toMatch(/^96989\d{9}$/);

    const second = await register('one-seat');
    expect(second.body.admission).toBe('候補');
    expect(second.body.va_account).toBeNull();
    expect(second.body.waitlist_position).toBe(1);

    const a = await availability();
    expect(a['one-seat']).toMatchObject({ remaining: 0, waitlist: 1 });
  });

  it('多人同時報名不會超收（10 人搶 2 個名額）', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => register('two-seats')));
    const admitted = results.filter((r) => r.body.admission === '正取');
    expect(admitted).toHaveLength(2);
    expect(results.filter((r) => r.body.va_account)).toHaveLength(2);
    const { n } = (await db().prepare(`SELECT COUNT(*) AS n FROM registrations WHERE admission = '正取'`).first<{ n: number }>())!;
    expect(n).toBe(2);
  });

  it('逾期未繳的名額會自動釋出給下一位', async () => {
    const first = await register('one-seat');
    await db().prepare(`UPDATE registrations SET va_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`).bind(first.body.id).run();
    const next = await register('one-seat');
    expect(next.body.admission).toBe('正取');
  });

  it('報名後記錄通知：家長 Email、簡訊、公司信箱（測試模式不寄出）', async () => {
    const { body } = await register('two-seats');
    const { results } = await db().prepare('SELECT channel, recipient, result FROM notifications WHERE registration_id = ?').bind(body.id).all<{ channel: string; recipient: string; result: string }>();
    expect(results.map((r) => r.channel).sort()).toEqual(['email', 'email', 'sms']);
    expect(results.some((r) => r.recipient === 'office@example.com')).toBe(true);
    expect(results.every((r) => r.result === 'mock')).toBe(true);
  });
});

describe('防竄改與輸入驗證', () => {
  it('金額一律以後台設定為準，前端送的金額無效', async () => {
    const { body } = await register('two-seats', { amount: 1, price: 1 });
    expect(body.amount).toBe(11000);
    expect((await getRegistration(body.id))!.amount).toBe(11000);
  });

  it('必填欄位錯誤會被擋下', async () => {
    const res = await call(registerRequest({ session_code: 'two-seats', student_name: '', phone: '123', email: 'x', agree: false }));
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain('學生姓名');
    expect(error).toContain('手機');
    expect(error).toContain('Email');
    expect(error).toContain('個人資料');
  });

  it('同一位學生不能重複報名同一時段', async () => {
    const data = validRegistration('two-seats');
    expect((await call(registerRequest(data))).status).toBe(200);
    expect((await call(registerRequest(data))).status).toBe(409);
  });

  it('不存在或暫停報名的時段會被拒絕', async () => {
    expect((await call(registerRequest(validRegistration('no-such-session')))).status).toBe(404);
    expect((await call(registerRequest(validRegistration('closed')))).status).toBe(409);
  });

  it('防機器人欄位有填寫時拒絕', async () => {
    expect((await call(registerRequest(validRegistration('two-seats', { website: 'http://spam' })))).status).toBe(400);
  });

  it('其他網站送來的報名請求被拒絕', async () => {
    expect((await call(registerRequest(validRegistration('two-seats'), { origin: 'https://evil.example' }))).status).toBe(403);
  });
});

describe('次數限制與正式網域保護', () => {
  it('同一個 IP 短時間內報名太多次會被擋下', async () => {
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await call(registerRequest(validRegistration('two-seats'), { ip }))).status);
    expect(statuses).toContain(429);
  });

  it('正式網域上若金流仍是測試模式，拒絕報名', async () => {
    const base = 'https://storykids.com.tw';
    const res = await call(registerRequest(validRegistration('two-seats'), { base }));
    expect(res.status).toBe(503);
    const config = (await (await call(new Request(`${base}/api/public-config`))).json()) as { registration_blocked: string | null };
    expect(config.registration_blocked).toBeTruthy();
  });

  it('正式網域上金流為正式模式時可以報名', async () => {
    const res = await call(registerRequest(validRegistration('two-seats'), { base: 'https://storykids.com.tw' }), { PAYMENT_MODE: 'live' });
    expect(res.status).toBe(200);
  });
});
