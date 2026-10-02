// Cloudflare Worker 入口
// 只有 /api/* 與 /admin 會進到這裡（見 wrangler.jsonc 的 run_worker_first），其餘網頁直接由靜態檔案提供
import type { Env } from './env';
import { json } from './env';
import { authenticateAdmin, sameOrigin } from './auth';
import { handleAvailability, handleRegister, registrationBlockedReason } from './register';
import { handleAdmin } from './admin';
import { handleCmsAuth } from './cms-auth';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ---- 報名管理後台（需登入） ----
      if (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/')) {
        const auth = await authenticateAdmin(request, env);
        if (!auth.ok) return auth.response;
        if (request.method !== 'GET' && !sameOrigin(request)) return json({ error: '來源不符' }, 403);

        if (path.startsWith('/api/admin/')) return await handleAdmin(request, env, auth.actor);

        // 後台頁面本身是靜態檔，通過驗證後才回傳，並禁止快取與搜尋引擎收錄
        const page = await env.ASSETS.fetch(request);
        const res = new Response(page.body, page);
        res.headers.set('Cache-Control', 'no-store');
        res.headers.set('X-Robots-Tag', 'noindex, nofollow');
        return res;
      }

      // ---- 前台 API ----
      // 前端需要的公開設定：Turnstile site key、是否暫停報名
      if (path === '/api/public-config' && request.method === 'GET') {
        return json({ turnstile_site_key: env.TURNSTILE_SITE_KEY || null, registration_blocked: registrationBlockedReason(request, env) });
      }
      if (path === '/api/availability' && request.method === 'GET') return await handleAvailability(request, env);
      if (path === '/api/register' && request.method === 'POST') {
        if (!sameOrigin(request)) return json({ error: '來源不符' }, 403);
        return await handleRegister(request, env, ctx);
      }

      // 內容後台（Sveltia CMS）的 GitHub 登入
      if (path.startsWith('/api/cms-auth/') && request.method === 'GET') return await handleCmsAuth(request, env);

      // 台新入帳通知：拿到台新規格書後實作（驗證來源與簽章 → 解密 → reconcile()）
      if (path === '/api/taishin/notify') return json({ error: '台新入帳通知尚未串接' }, 501);

      if (path.startsWith('/api/')) return json({ error: '找不到' }, 404);
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return json({ error: '系統忙碌中，請稍後再試' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
