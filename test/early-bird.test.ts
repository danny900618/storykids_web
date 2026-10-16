// 早鳥折扣：期限內報名費用打折並依折扣後金額產生帳號；過期恢復原價；候補遞補維持報名當時的價格；期限含當天
import { beforeEach, describe, expect, it } from 'vitest';
import { priceFor, type Session } from '../src/worker/env';
import { earlyBirdUntil } from '../src/lib/site';
import { isValidVirtualAccount } from '../src/worker/taishin';
import { adminRequest, call, db, getRegistration, register, resetDb } from './helpers';

beforeEach(resetDb);
const live = { PAYMENT_MODE: 'live' };

describe('早鳥折扣', () => {
  it('截止日當天台灣時間 23:59:59 前都有效', () => {
    expect(earlyBirdUntil({ price: 11000, early_bird_deadline: new Date('2026-10-31'), early_bird_discount: 1000 })).toBe('2026-10-31T15:59:59.999Z');
    const s = { price: 11000, early_bird_until: '2026-10-31T15:59:59.999Z', early_bird_discount: 1000 } as Session;
    expect(priceFor(s, new Date('2026-10-31T15:59:59.000Z'))).toEqual({ amount: 10000, earlyBirdDiscount: 1000 }); // 台灣 10/31 23:59:59
    expect(priceFor(s, new Date('2026-10-31T16:00:00.000Z'))).toEqual({ amount: 11000, earlyBirdDiscount: null }); // 台灣 11/1 00:00
  });

  it('折扣無效時不套用：沒填截止日、折扣為 0、折扣大於等於費用', () => {
    expect(earlyBirdUntil({ price: 11000, early_bird_discount: 1000 })).toBeUndefined();
    expect(earlyBirdUntil({ price: 11000, early_bird_deadline: new Date('2099-01-01'), early_bird_discount: 0 })).toBeUndefined();
    expect(earlyBirdUntil({ price: 1000, early_bird_deadline: new Date('2099-01-01'), early_bird_discount: 1000 })).toBeUndefined();
  });

  it('期限內報名：應繳金額打折、記錄折扣、繳費帳號依折扣後金額產生、通知信註明早鳥', async () => {
    const { body } = await register('early-bird', { amount: 1 }, live);
    expect(body.amount).toBe(10000);
    const row = (await getRegistration(body.id))!;
    expect(row).toMatchObject({ amount: 10000, early_bird_discount: 1000 });
    expect(isValidVirtualAccount(row.va_account!, 10000)).toBe(true);
    expect(isValidVirtualAccount(row.va_account!, 11000)).toBe(false);
    const mail = await db().prepare(`SELECT body FROM notifications WHERE registration_id = ? AND channel = 'email' AND recipient != 'office@example.com'`).bind(body.id).first<{ body: string }>();
    expect(mail!.body).toContain('早鳥優惠');
  });

  it('期限過後報名：恢復原價', async () => {
    const { body } = await register('early-bird-expired');
    expect(body.amount).toBe(11000);
    expect((await getRegistration(body.id))!.early_bird_discount).toBeNull();
  });

  it('早鳥期間登記候補，遞補時維持報名當時的早鳥價', async () => {
    await register('early-bird-one', {}, live);
    const waitlisted = (await register('early-bird-one', {}, live)).body;
    expect(waitlisted.admission).toBe('候補');
    const res = await call(adminRequest(`/api/admin/registrations/${waitlisted.id}`, { method: 'PATCH', body: JSON.stringify({ admission: '正取' }) }), live);
    expect(res.status).toBe(200);
    const row = (await getRegistration(waitlisted.id))!;
    expect(row.amount).toBe(7500);
    expect(isValidVirtualAccount(row.va_account!, 7500)).toBe(true);
  });
});
