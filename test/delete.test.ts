// 刪除報名（誤報名，軟刪除）：釋放名額、列表隱藏、已繳費不能刪、刪除後入帳轉人工確認、復原時檢查名額
import { beforeEach, describe, expect, it } from 'vitest';
import { adminRequest, call, db, getRegistration, register, resetDb, validRegistration, registerRequest } from './helpers';

beforeEach(resetDb);
const post = (id: number, action: string, body: object = {}) =>
  call(adminRequest(`/api/admin/registrations/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) }));
const list = async (q = '') => (await (await call(adminRequest(`/api/admin/registrations${q}`))).json()) as { id: number }[];

describe('刪除報名', () => {
  it('需要填原因；刪除後釋放名額、預設列表隱藏、「已刪除」看得到，並記錄操作', async () => {
    const first = (await register('one-seat')).body;
    expect((await post(first.id, 'delete')).status).toBe(400);
    expect((await post(first.id, 'delete', { reason: '家長重複報名' })).status).toBe(200);
    expect((await list()).map((r) => r.id)).not.toContain(first.id);
    expect((await list('?status=已刪除')).map((r) => r.id)).toEqual([first.id]);
    // 名額釋出：下一位是正取
    expect((await register('one-seat')).body.admission).toBe('正取');
    const audit = await db().prepare(`SELECT actor, detail FROM audit_log WHERE registration_id = ? AND action = '刪除報名'`).bind(first.id).first<{ actor: string; detail: string }>();
    expect(audit).toMatchObject({ actor: 'password:staff' });
    expect(audit!.detail).toContain('家長重複報名');
  });

  it('已繳費的報名不能刪除', async () => {
    const reg = (await register('two-seats')).body;
    await call(adminRequest(`/api/admin/registrations/${reg.id}/mock-payment`, { method: 'POST', body: '{}' }));
    const res = await post(reg.id, 'delete', { reason: '測試' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('取消報名');
    expect((await getRegistration(reg.id))!.deleted_at).toBeNull();
  });

  it('刪除後同一位學生可以重新報名；刪除的報名不能改狀態或資料', async () => {
    const data = validRegistration('two-seats');
    const first = (await (await call(registerRequest(data))).json()) as { id: number };
    await post(first.id, 'delete', { reason: '填錯時段' });
    expect((await call(registerRequest(data))).status).toBe(200);
    const patch = await call(adminRequest(`/api/admin/registrations/${first.id}`, { method: 'PATCH', body: JSON.stringify({ status: '已付費' }) }));
    expect(patch.status).toBe(400);
  });

  it('刪除後家長仍轉帳：不會變已付費，標記需人工確認', async () => {
    const reg = (await register('two-seats')).body;
    await post(reg.id, 'delete', { reason: '誤報名' });
    const out = (await (await call(adminRequest(`/api/admin/registrations/${reg.id}/mock-payment`, { method: 'POST', body: '{}' }))).json()) as { result: string };
    expect(out.result).toBe('not_payable');
    const row = (await getRegistration(reg.id))!;
    expect(row.status).toBe('等待付費');
    expect(row.review_note).toContain('已刪除的報名');
  });

  it('復原：名額還在可以復原；名額已被別人報走時不能以正取復原', async () => {
    const first = (await register('one-seat')).body;
    await post(first.id, 'delete', { reason: '誤刪測試' });
    expect((await post(first.id, 'restore')).status).toBe(200);
    expect((await getRegistration(first.id))!.deleted_at).toBeNull();

    await post(first.id, 'delete', { reason: '誤刪測試' });
    await register('one-seat'); // 名額被別人報走
    expect((await post(first.id, 'restore')).status).toBe(409);
  });

  it('只剩已刪除報名的時段，不會被當成「CMS 已刪除的時段」', async () => {
    await db().prepare(
      `INSERT INTO registrations (session_code, course_id, course_title, session_name, student_name, parent_name, phone, email,
        admission, status, amount, deleted_at, created_at, updated_at)
       VALUES ('s-gone', 'c', '課', '時段', '學生', '家長', '0911222333', 'a@example.com', '正取', '等待付費', 1000, '2026-10-16T00:00:00Z', '2026-10-16T00:00:00Z', '2026-10-16T00:00:00Z')`,
    ).run();
    const { orphans } = (await (await call(adminRequest('/api/admin/sessions'))).json()) as { orphans: string[] };
    expect(orphans).not.toContain('s-gone');
  });
});
