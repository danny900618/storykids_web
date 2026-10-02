// 後台登入驗證（/admin 與 /api/admin/*）
// 優先順序：Cloudflare Access → 暫時密碼（HTTP Basic）→ 本機開發略過；都沒設定則拒絕（fail closed）
import type { Env } from './env';
import { clientIp, isLocalRequest } from './env';

export type AuthResult = { ok: true; actor: string } | { ok: false; response: Response };

// 登入失敗次數限制：同一個 IP 失敗太多次就暫時擋下，防止暴力猜密碼
async function tooManyFailures(request: Request, env: Env): Promise<Response | null> {
  if (!env.LOGIN_LIMITER) return null;
  const { success } = await env.LOGIN_LIMITER.limit({ key: `login:${clientIp(request)}` });
  return success ? null : new Response('登入失敗次數過多，請稍後再試', { status: 429, headers: { 'Retry-After': '60' } });
}

export async function authenticateAdmin(request: Request, env: Env): Promise<AuthResult> {
  // 1. Cloudflare Access：驗證 Access 簽發的 JWT
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    const email = token ? await verifyAccessJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD) : null;
    if (email) return { ok: true, actor: email };
    return { ok: false, response: (await tooManyFailures(request, env)) ?? new Response('需要透過 Cloudflare Access 登入', { status: 403 }) };
  }

  // 2. 暫時密碼（HTTP Basic，帳號任意）
  if (env.ADMIN_PASSWORD) {
    const header = request.headers.get('Authorization') ?? '';
    if (header.startsWith('Basic ')) {
      let decoded = '';
      try {
        decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)));
      } catch {
        // 格式錯誤的 Authorization 視為密碼錯誤
      }
      const [user, ...rest] = decoded.split(':');
      if (await timingSafeEqual(rest.join(':'), env.ADMIN_PASSWORD)) return { ok: true, actor: `password:${user || 'admin'}` };
      // 有送出密碼但錯誤 → 計入失敗次數
      const blocked = await tooManyFailures(request, env);
      if (blocked) return { ok: false, response: blocked };
    }
    return {
      ok: false,
      response: new Response('請輸入後台密碼', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="storykids-admin", charset="UTF-8"' } }),
    };
  }

  // 3. 本機開發：只在 localhost／127.0.0.1 生效，就算誤設到正式環境也不會開放
  if (env.ADMIN_DEV_BYPASS === 'true' && isLocalRequest(request)) return { ok: true, actor: 'dev' };

  return { ok: false, response: new Response('後台尚未設定登入方式，已停用', { status: 403 }) };
}

// 防止 CSRF：會修改資料的後台請求必須來自同一個網域
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

// ---- Cloudflare Access JWT 驗證 ----
let certCache: { at: number; keys: JsonWebKey[] } | null = null;

async function getAccessKeys(teamDomain: string): Promise<JsonWebKey[]> {
  if (certCache && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  const { keys } = (await res.json()) as { keys: JsonWebKey[] };
  certCache = { at: Date.now(), keys };
  return keys;
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function verifyAccessJwt(token: string, teamDomain: string, aud: string): Promise<string | null> {
  try {
    const [h, p, sig] = token.split('.');
    const header = JSON.parse(new TextDecoder().decode(b64url(h))) as { kid: string; alg: string };
    const payload = JSON.parse(new TextDecoder().decode(b64url(p))) as { aud: string | string[]; exp: number; iss: string; email?: string };
    if (header.alg !== 'RS256') return null;
    const jwk = (await getAccessKeys(teamDomain)).find((k) => (k as { kid?: string }).kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
    const audOk = Array.isArray(payload.aud) ? payload.aud.includes(aud) : payload.aud === aud;
    if (!valid || !audOk || payload.exp * 1000 < Date.now() || payload.iss !== `https://${teamDomain}`) return null;
    return payload.email ?? 'access-user';
  } catch {
    return null;
  }
}
