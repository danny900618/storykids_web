// 金流對帳：正確入帳、重複通知、金額不符、逾期入帳、查無帳號、重複繳費、已取消仍入帳
import { beforeEach, describe, expect, it } from 'vitest';
import { reconcile } from '../src/worker/payment';
import { adminRequest, baseEnv, call, db, getRegistration, register, resetDb } from './helpers';

beforeEach(resetDb);

async function admitted() {
  const { body } = await register('two-seats');
  expect(body.admission).toBe('正取');
  return body;
}

describe('自動對帳 reconcile()', () => {
  it('金額正確 → 已付費，並記錄收據通知', async () => {
    const reg = await admitted();
    const out = await reconcile(baseEnv(), { ref: 'T-1', vaAccount: reg.va_account!, amount: 11000 });
    expect(out.result).toBe('paid');
    const row = (await getRegistration(reg.id))!;
    expect(row.status).toBe('已付費');
    expect(row.paid_amount).toBe(11000);
    expect(row.review_note).toBeNull();
    const { n } = (await db().prepare(`SELECT COUNT(*) AS n FROM notifications WHERE registration_id = ? AND subject LIKE '%繳費完成%'`).bind(reg.id).first<{ n: number }>())!;
    expect(n).toBe(1);
  });

  it('同一筆入帳通知重送（交易序號相同）只處理一次', async () => {
    const reg = await admitted();
    await reconcile(baseEnv(), { ref: 'T-dup', vaAccount: reg.va_account!, amount: 11000 });
    const again = await reconcile(baseEnv(), { ref: 'T-dup', vaAccount: reg.va_account!, amount: 11000 });
    expect(again.result).toBe('duplicate_event');
    const { n } = (await db().prepare(`SELECT COUNT(*) AS n FROM payment_events WHERE ref = 'T-dup'`).first<{ n: number }>())!;
    expect(n).toBe(1);
  });

  it('金額不符 → 不改成已付費，標記需人工確認', async () => {
    const reg = await admitted();
    const out = await reconcile(baseEnv(), { ref: 'T-2', vaAccount: reg.va_account!, amount: 1 });
    expect(out.result).toBe('amount_mismatch');
    const row = (await getRegistration(reg.id))!;
    expect(row.status).toBe('等待付費');
    expect(row.review_note).toContain('金額不符');
  });

  it('逾期後才入帳 → 不改成已付費，標記需人工確認（避免名額已給別人造成超收）', async () => {
    const reg = await admitted();
    await db().prepare(`UPDATE registrations SET va_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`).bind(reg.id).run();
    const out = await reconcile(baseEnv(), { ref: 'T-3', vaAccount: reg.va_account!, amount: 11000 });
    expect(out.result).toBe('paid_late');
    const row = (await getRegistration(reg.id))!;
    expect(row.status).not.toBe('已付費');
    expect(row.review_note).toContain('逾期');
  });

  it('查無帳號 → 記錄但不影響任何報名', async () => {
    const out = await reconcile(baseEnv(), { ref: 'T-4', vaAccount: '96989999999999', amount: 11000 });
    expect(out.result).toBe('unmatched');
  });

  it('已繳清又收到款項 → 標記重複繳費', async () => {
    const reg = await admitted();
    await reconcile(baseEnv(), { ref: 'T-5a', vaAccount: reg.va_account!, amount: 11000 });
    const out = await reconcile(baseEnv(), { ref: 'T-5b', vaAccount: reg.va_account!, amount: 11000 });
    expect(out.result).toBe('already_paid');
    expect((await getRegistration(reg.id))!.review_note).toContain('重複繳費');
  });

  it('已取消的報名仍收到款項 → 標記需人工確認', async () => {
    const reg = await admitted();
    await db().prepare(`UPDATE registrations SET status = '取消報名' WHERE id = ?`).bind(reg.id).run();
    const out = await reconcile(baseEnv(), { ref: 'T-6', vaAccount: reg.va_account!, amount: 11000 });
    expect(out.result).toBe('not_payable');
    expect((await getRegistration(reg.id))!.status).toBe('取消報名');
  });
});

describe('後台模擬入帳', () => {
  it('測試模式可以模擬入帳', async () => {
    const reg = await admitted();
    const res = await call(adminRequest(`/api/admin/registrations/${reg.id}/mock-payment`, { method: 'POST', body: '{}' }));
    expect(((await res.json()) as { result: string }).result).toBe('paid');
  });

  it('正式模式不能模擬入帳（無法用後台偽造付款）', async () => {
    const reg = await admitted();
    const res = await call(adminRequest(`/api/admin/registrations/${reg.id}/mock-payment`, { method: 'POST', body: '{}' }), { PAYMENT_MODE: 'live' });
    expect(res.status).toBe(403);
  });

  it('候補沒有繳費帳號，不能入帳', async () => {
    await register('one-seat');
    const waitlisted = await register('one-seat');
    const res = await call(adminRequest(`/api/admin/registrations/${waitlisted.body.id}/mock-payment`, { method: 'POST', body: '{}' }));
    expect(res.status).toBe(400);
  });
});
