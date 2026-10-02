// 測試共用工具：固定的測試時段、呼叫 Worker、清空資料
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import worker from '../src/worker/index';
import type { Env, Registration, Session } from '../src/worker/env';

export const ORIGIN = 'https://storykids-web.example.workers.dev';
export const ADMIN_PASSWORD = 'test-password-123456';

// 測試用時段（不依賴網站內容）
export const SESSIONS: Session[] = [
  { code: 'two-seats', name: '測試 A', time: '週三', capacity: 2, price: 11000, open: true, course_id: 'c1', course_title: '測試課程' },
  { code: 'one-seat', name: '測試 B', time: '週六', capacity: 1, price: 6000, open: true, course_id: 'c1', course_title: '測試課程' },
  { code: 'closed', name: '測試 C', time: '週日', capacity: 5, price: 5000, open: false, course_id: 'c1', course_title: '測試課程' },
];

// 取代靜態檔案：只提供 /data/sessions.json
const fakeAssets = {
  fetch: async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/data/sessions.json') return Response.json(SESSIONS);
    return new Response('<html>page</html>', { headers: { 'Content-Type': 'text/html' } });
  },
} as unknown as Fetcher;

// 測試環境：密碼登入、測試模式、不驗證 Turnstile
export const baseEnv = (): Env =>
  ({
    ...(env as unknown as Env),
    ASSETS: fakeAssets,
    ADMIN_PASSWORD,
    ADMIN_DEV_BYPASS: undefined,
    ACCESS_TEAM_DOMAIN: undefined,
    ACCESS_AUD: undefined,
    TURNSTILE_SECRET_KEY: undefined,
    PAYMENT_MODE: 'mock',
    MAIL_MODE: 'mock',
    SMS_MODE: 'mock',
    COMPANY_EMAIL: 'office@example.com',
    PRODUCTION_HOSTS: 'storykids.com.tw,www.storykids.com.tw',
  }) as Env;

// 呼叫 Worker，並等背景工作（寄通知）完成
export async function call(request: Request, overrides: Partial<Env> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, { ...baseEnv(), ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

let ipCounter = 0;
// 每次報名使用不同 IP，避免觸發次數限制（測試次數限制時會指定同一個 IP）
export const nextIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

export function registerRequest(body: Record<string, unknown>, opts: { ip?: string; origin?: string; base?: string } = {}) {
  return new Request(`${opts.base ?? ORIGIN}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: opts.origin ?? opts.base ?? ORIGIN, 'CF-Connecting-IP': opts.ip ?? nextIp() },
    body: JSON.stringify(body),
  });
}

let studentCounter = 0;
export function validRegistration(sessionCode: string, extra: Record<string, unknown> = {}) {
  studentCounter++;
  return {
    session_code: sessionCode,
    student_name: `學生${studentCounter}`,
    parent_name: '家長',
    school: '測試國小',
    grade: '國小一年級',
    phone: `09${String(10000000 + studentCounter).slice(-8)}`,
    email: `parent${studentCounter}@example.com`,
    agree: true,
    ...extra,
  };
}

export async function register(sessionCode: string, extra: Record<string, unknown> = {}) {
  const res = await call(registerRequest(validRegistration(sessionCode, extra)));
  return { res, body: (await res.json()) as Record<string, unknown> & { id: number; admission: string; va_account: string | null; amount: number } };
}

export function adminRequest(path: string, init: RequestInit & { password?: string; ip?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Basic ${btoa(`staff:${init.password ?? ADMIN_PASSWORD}`)}`);
  headers.set('Origin', ORIGIN);
  headers.set('CF-Connecting-IP', init.ip ?? nextIp());
  if (init.body) headers.set('Content-Type', 'application/json');
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

export const db = () => baseEnv().DB;
export const getRegistration = (id: number) => db().prepare('SELECT * FROM registrations WHERE id = ?').bind(id).first<Registration>();

// 每個測試前清空資料表
export async function resetDb() {
  await db().batch(['notifications', 'payment_events', 'audit_log', 'registrations'].map((t) => db().prepare(`DELETE FROM ${t}`)));
}
