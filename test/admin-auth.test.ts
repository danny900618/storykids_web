// 後台登入與後台操作：登入方式、失敗次數限制、跨站請求、遞補、取消、匯出
import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_PASSWORD, ORIGIN, adminRequest, call, db, getRegistration, nextIp, register, resetDb } from './helpers';

beforeEach(resetDb);

describe('後台登入', () => {
  it('沒有密碼 → 401', async () => {
    expect((await call(new Request(`${ORIGIN}/admin`))).status).toBe(401);
    expect((await call(new Request(`${ORIGIN}/api/admin/config`))).status).toBe(401);
  });

  it('密碼錯誤 → 401；密碼正確 → 200', async () => {
    expect((await call(adminRequest('/api/admin/config', { password: 'wrong' }))).status).toBe(401);
    expect((await call(adminRequest('/api/admin/config'))).status).toBe(200);
  });

  it('同一個 IP 連續猜錯密碼會被暫時擋下', async () => {
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await call(adminRequest('/api/admin/config', { password: `guess-${i}`, ip }))).status);
    expect(statuses).toContain(429);
  });

  it('沒有設定任何登入方式時，後台一律拒絕（fail closed）', async () => {
    expect((await call(new Request(`${ORIGIN}/api/admin/config`), { ADMIN_PASSWORD: undefined })).status).toBe(403);
  });

  it('「略過登入」只在本機網址有效，正式環境誤設也不會開放', async () => {
    const overrides = { ADMIN_PASSWORD: undefined, ADMIN_DEV_BYPASS: 'true' };
    expect((await call(new Request(`${ORIGIN}/api/admin/config`), overrides)).status).toBe(403);
    expect((await call(new Request('http://127.0.0.1:8787/api/admin/config'), overrides)).status).toBe(200);
  });

  it('設定 Cloudflare Access 後，沒有有效的 Access 憑證一律拒絕', async () => {
    const overrides = { ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com', ACCESS_AUD: 'aud' };
    expect((await call(adminRequest('/api/admin/config'), overrides)).status).toBe(403);
    const forged = new Request(`${ORIGIN}/api/admin/config`, { headers: { 'Cf-Access-Jwt-Assertion': 'aaa.bbb.ccc' } });
    expect((await call(forged, overrides)).status).toBe(403);
  });

  it('其他網站送來的後台修改請求被拒絕（CSRF）', async () => {
    const { body } = await register('two-seats');
    const req = new Request(`${ORIGIN}/api/admin/registrations/${body.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Basic ${btoa(`x:${ADMIN_PASSWORD}`)}`, Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: '已付費' }),
    });
    expect((await call(req)).status).toBe(403);
    expect((await getRegistration(body.id))!.status).toBe('等待付費');
  });

  it('奇怪的路徑寫法不會繞過登入取得後台資料', async () => {
    for (const path of ['/api//admin/config', '/api/admin', '/API/admin/config', '/api/admin/../admin/config']) {
      const res = await call(new Request(`${ORIGIN}${path}`));
      const text = await res.text();
      expect(text).not.toContain('"actor"');
      expect(text).not.toContain('"statuses"');
    }
  });
});

describe('後台操作', () => {
  const patch = (id: number, body: object) => call(adminRequest(`/api/admin/registrations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }));

  it('候補遞補為正取：產生繳費帳號並通知家長', async () => {
    await register('one-seat');
    const waitlisted = (await register('one-seat')).body;
    expect((await patch(waitlisted.id, { admission: '正取' })).status).toBe(200);
    const row = (await getRegistration(waitlisted.id))!;
    expect(row.admission).toBe('正取');
    expect(row.status).toBe('等待付費');
    expect(row.va_account).toMatch(/^96989\d{9}$/);
    const { n } = (await db().prepare(`SELECT COUNT(*) AS n FROM notifications WHERE registration_id = ? AND subject LIKE '%遞補%'`).bind(waitlisted.id).first<{ n: number }>())!;
    expect(n).toBe(1);
  });

  it('取消報名後名額釋出', async () => {
    const first = (await register('one-seat')).body;
    await patch(first.id, { status: '取消報名' });
    expect((await register('one-seat')).body.admission).toBe('正取');
  });

  it('手動標記現金繳清會記錄入帳資訊並寫入操作紀錄', async () => {
    const reg = (await register('two-seats')).body;
    await patch(reg.id, { status: '現金繳清' });
    const row = (await getRegistration(reg.id))!;
    expect(row.paid_at).not.toBeNull();
    expect(row.paid_amount).toBe(11000);
    const audit = await db().prepare('SELECT actor, detail FROM audit_log WHERE registration_id = ?').bind(reg.id).first<{ actor: string; detail: string }>();
    expect(audit!.actor).toBe('password:staff');
    expect(audit!.detail).toContain('現金繳清');
  });

  it('不存在的狀態會被拒絕', async () => {
    const reg = (await register('two-seats')).body;
    expect((await patch(reg.id, { status: '亂打的狀態' })).status).toBe(400);
  });

  it('後台處理後清除「需人工確認」標記', async () => {
    const reg = (await register('two-seats')).body;
    await db().prepare(`UPDATE registrations SET review_note = '測試' WHERE id = ?`).bind(reg.id).run();
    await patch(reg.id, { status: '已付費' });
    expect((await getRegistration(reg.id))!.review_note).toBeNull();
  });

  it('操作紀錄：進入後台（30 分鐘內只記一次）、匯出名單、模擬入帳都會記錄使用者', async () => {
    await call(adminRequest('/api/admin/config'));
    await call(adminRequest('/api/admin/config'));
    const reg = (await register('two-seats')).body;
    await call(adminRequest(`/api/admin/registrations/${reg.id}/mock-payment`, { method: 'POST', body: '{}' }));
    await call(adminRequest('/api/admin/export.csv?session=two-seats'));
    const res = await call(adminRequest('/api/admin/audit'));
    const { items, actors } = (await res.json()) as { items: { actor: string; action: string; detail: string; registration_id: number | null }[]; actors: string[] };
    expect(items.filter((i) => i.action === '進入後台')).toHaveLength(1);
    expect(items.find((i) => i.action === '模擬入帳')).toMatchObject({ actor: 'password:staff', registration_id: reg.id });
    expect(items.find((i) => i.action === '匯出名單')!.detail).toContain('session=two-seats');
    expect(items.some((i) => i.action === '自動對帳' && i.actor === 'system')).toBe(true);
    expect(actors).toContain('password:staff');
    // 新到舊排序
    expect(items[0].action).toBe('匯出名單');
  });

  it('操作紀錄需要登入', async () => {
    expect((await call(new Request(`${ORIGIN}/api/admin/audit`))).status).toBe(401);
  });

  it('匯出 CSV：Excel 可直接開啟（BOM），並防止公式注入', async () => {
    await register('two-seats', { student_name: '=HYPERLINK("http://evil")' });
    const res = await call(adminRequest('/api/admin/export.csv'));
    const bytes = new Uint8Array(await res.arrayBuffer());
    // UTF-8 BOM（EF BB BF）：res.text() 會自動去掉，所以檢查原始位元組
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain(`'=HYPERLINK`);
    expect(text).not.toMatch(/,=HYPERLINK/);
  });
});
