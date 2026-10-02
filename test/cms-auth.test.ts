// 內容後台的 GitHub 登入：防偽造、只把憑證交給允許的網址
import { describe, expect, it } from 'vitest';
import { ORIGIN, call } from './helpers';

const github = { GITHUB_CLIENT_ID: 'client-id', GITHUB_CLIENT_SECRET: 'client-secret', CMS_ALLOWED_ORIGINS: 'https://storykids.com.tw' };

describe('內容後台 GitHub 登入', () => {
  it('導向 GitHub 授權頁並設定防偽造 cookie', async () => {
    const res = await call(new Request(`${ORIGIN}/api/cms-auth/auth?provider=github&site_id=x`), github);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(location.origin).toBe('https://github.com');
    const state = location.searchParams.get('state')!;
    expect(res.headers.get('Set-Cookie')).toContain(`cms-csrf=${state}`);
    expect(res.headers.get('Set-Cookie')).toContain('HttpOnly');
  });

  it('未設定 OAuth App 時回傳錯誤，不會導向', async () => {
    const res = await call(new Request(`${ORIGIN}/api/cms-auth/auth?provider=github`), { GITHUB_CLIENT_ID: undefined, GITHUB_CLIENT_SECRET: undefined });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('MISCONFIGURED_CLIENT');
  });

  it('不支援的登入方式被拒絕', async () => {
    const res = await call(new Request(`${ORIGIN}/api/cms-auth/auth?provider=gitlab`), github);
    expect(await res.text()).toContain('UNSUPPORTED_BACKEND');
  });

  it('state 與 cookie 不符（偽造的授權回呼）被拒絕', async () => {
    const res = await call(
      new Request(`${ORIGIN}/api/cms-auth/callback?code=abc&state=${'a'.repeat(32)}`, { headers: { Cookie: `cms-csrf=${'b'.repeat(32)}` } }),
      github,
    );
    expect(await res.text()).toContain('CSRF_DETECTED');
  });

  it('沒有 cookie 的授權回呼被拒絕', async () => {
    const res = await call(new Request(`${ORIGIN}/api/cms-auth/callback?code=abc&state=${'a'.repeat(32)}`), github);
    expect(await res.text()).toContain('CSRF_DETECTED');
  });

  it('憑證只會交給允許的網址（本站與設定的網址）', async () => {
    const res = await call(new Request(`${ORIGIN}/api/cms-auth/callback?code=abc&state=x`), github);
    const html = await res.text();
    const allowed = JSON.parse(html.match(/const allowed = (\[.*?\]);/)![1]) as string[];
    expect(allowed).toEqual([ORIGIN, 'https://storykids.com.tw']);
  });
});
