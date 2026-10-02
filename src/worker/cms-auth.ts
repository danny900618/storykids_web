// 內容後台（Sveltia CMS）的 GitHub 登入：OAuth 授權流程
// 協定與官方 sveltia-cms-auth 相同（https://github.com/sveltia/sveltia-cms-auth），直接內建在本專案的 Worker，
// 不需要另外部署登入服務，也不依賴任何第三方伺服器。
//   /api/cms-auth/auth      → 導向 GitHub 授權頁
//   /api/cms-auth/callback  → GitHub 授權後回到這裡，用 code 換 token，再用 postMessage 交給 CMS 視窗
// 需要：GitHub OAuth App（Authorization callback URL 填 https://網站網址/api/cms-auth/callback）
//       環境變數 GITHUB_CLIENT_ID、secret GITHUB_CLIENT_SECRET
import type { Env } from './env';

const PROVIDER = 'github';
const SCOPE = 'repo,user';

// 只把 token 交給允許的網站（CMS 所在的網址）
function allowedOrigins(env: Env, request: Request): string[] {
  const list = (env.CMS_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return [new URL(request.url).origin, ...list];
}

function outputHTML(env: Env, request: Request, content: { token?: string; error?: string; errorCode?: string }): Response {
  const state = content.error ? 'error' : 'success';
  const payload = JSON.stringify(content.error ? { provider: PROVIDER, error: content.error, errorCode: content.errorCode } : { provider: PROVIDER, token: content.token });
  const message = `authorization:${PROVIDER}:${state}:${payload}`;
  // 輸出到 <script> 內的字串一律 JSON 編碼並跳脫 <，避免注入
  const js = (v: unknown) => JSON.stringify(v).replaceAll('<', '\\u003c');
  return new Response(
    `<!doctype html><html><body><script>
      (() => {
        const allowed = ${js(allowedOrigins(env, request))};
        window.addEventListener('message', ({ data, origin }) => {
          if (data !== 'authorizing:${PROVIDER}' || !allowed.includes(origin)) return;
          window.opener?.postMessage(${js(message)}, origin);
        });
        window.opener?.postMessage('authorizing:${PROVIDER}', '*');
      })();
    </script></body></html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': 'cms-csrf=deleted; HttpOnly; Max-Age=0; Path=/api/cms-auth; SameSite=Lax; Secure',
      },
    },
  );
}

export async function handleCmsAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/cms-auth/auth') {
    if (url.searchParams.get('provider') !== PROVIDER) return outputHTML(env, request, { error: '不支援的登入方式', errorCode: 'UNSUPPORTED_BACKEND' });
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return outputHTML(env, request, { error: '尚未設定 GitHub OAuth App', errorCode: 'MISCONFIGURED_CLIENT' });
    }
    const csrf = crypto.randomUUID().replaceAll('-', '');
    const params = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, scope: SCOPE, state: csrf });
    return new Response(null, {
      status: 302,
      headers: {
        Location: `https://github.com/login/oauth/authorize?${params}`,
        'Set-Cookie': `cms-csrf=${csrf}; HttpOnly; Path=/api/cms-auth; Max-Age=600; SameSite=Lax; Secure`,
      },
    });
  }

  if (url.pathname === '/api/cms-auth/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const csrf = request.headers.get('Cookie')?.match(/\bcms-csrf=([0-9a-f]{32})\b/)?.[1];
    if (!code || !state) return outputHTML(env, request, { error: '沒有收到 GitHub 授權碼，請再試一次', errorCode: 'AUTH_CODE_REQUEST_FAILED' });
    if (!csrf || state !== csrf) return outputHTML(env, request, { error: '登入驗證失敗，請再試一次', errorCode: 'CSRF_DETECTED' });
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return outputHTML(env, request, { error: '尚未設定 GitHub OAuth App', errorCode: 'MISCONFIGURED_CLIENT' });
    }
    try {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET }),
      });
      const data = (await res.json()) as { access_token?: string; error?: string };
      if (!data.access_token) return outputHTML(env, request, { error: data.error ?? '取得授權失敗', errorCode: 'TOKEN_REQUEST_FAILED' });
      return outputHTML(env, request, { token: data.access_token });
    } catch {
      return outputHTML(env, request, { error: '無法連線到 GitHub，請稍後再試', errorCode: 'TOKEN_REQUEST_FAILED' });
    }
  }

  return new Response('Not found', { status: 404 });
}
