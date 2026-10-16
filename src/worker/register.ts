// 前台 API：額滿查詢、線上報名
import type { Env, Registration, Session } from './env';
import { clientIp, holdsSeatSql, json, nowIso, paymentDeadline, priceFor } from './env';
import { countBySession, findSession, loadSessions } from './sessions';
import { generateVirtualAccount } from './payment';
import { notifyRegistered } from './notify';
import { readProfile, validateProfile } from './profile';

// GET /api/availability：各時段是否額滿（前台不顯示剩餘名額，只顯示「額滿請候補」）
export async function handleAvailability(request: Request, env: Env): Promise<Response> {
  const [sessions, counts] = await Promise.all([loadSessions(env, request), countBySession(env)]);
  const data: Record<string, { full: boolean; open: boolean }> = {};
  for (const s of sessions) {
    data[s.code] = { full: (counts.get(s.code)?.taken ?? 0) >= s.capacity, open: s.open };
  }
  return json(data);
}

interface RegisterInput extends Record<string, unknown> {
  session_code?: string;
  agree?: boolean; // 同意補課辦法、退費辦法（報名第二步）
  website?: string; // 防機器人欄位（畫面上隱藏），有填就是機器人
  turnstile_token?: string; // Cloudflare Turnstile 驗證結果
}

// 家長同意的報名辦法（存名稱快照）
const agreedPolicies = (s: Session) =>
  [s.makeup_rule_title && `補課辦法：${s.makeup_rule_title}`, s.refund_rule_title && `退費辦法：${s.refund_rule_title}`].filter(Boolean).join('；') || null;

// Cloudflare Turnstile 伺服器端驗證
async function verifyTurnstile(env: Env, token: string | undefined, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true; // 尚未設定時略過（仍有次數限制）
  if (!token) return false;
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  form.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const out = (await res.json()) as { success?: boolean };
    return out.success === true;
  } catch {
    return false;
  }
}

// 正式網域上，金流若仍是測試模式就不開放報名（避免家長拿到假的繳費帳號）
export function registrationBlockedReason(request: Request, env: Env): string | null {
  const host = new URL(request.url).hostname;
  const productionHosts = (env.PRODUCTION_HOSTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (productionHosts.includes(host) && env.PAYMENT_MODE !== 'live') return '線上報名系統準備中，請透過 LINE 或電話與講堂聯繫報名';
  return null;
}

// POST /api/register：線上報名
export async function handleRegister(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const blocked = registrationBlockedReason(request, env);
  if (blocked) return json({ error: blocked }, 503);

  // 次數限制：同一個 IP 短時間內報名太多次（防止灌假報名佔名額）
  const ip = clientIp(request);
  if (env.REGISTER_LIMITER) {
    const { success } = await env.REGISTER_LIMITER.limit({ key: `register:${ip}` });
    if (!success) return json({ error: '送出次數過多，請稍後再試' }, 429);
  }

  if (!request.headers.get('Content-Type')?.includes('application/json')) return json({ error: '格式錯誤' }, 415);
  const body = (await request.json().catch(() => null)) as RegisterInput | null;
  if (!body) return json({ error: '格式錯誤' }, 400);
  if (body.website) return json({ error: '報名失敗' }, 400);
  if (!(await verifyTurnstile(env, body.turnstile_token, ip))) return json({ error: '驗證失敗，請重新整理頁面後再送出' }, 400);

  const sessionCode = typeof body.session_code === 'string' ? body.session_code.trim().slice(0, 60) : '';
  const input = readProfile(body);
  const errors = validateProfile(input, 'register');
  if (body.agree !== true) errors.push('請閱讀並勾選同意補課辦法與退費辦法');
  if (errors.length) return json({ error: errors.join('、') }, 400);

  const session = await findSession(env, request, sessionCode);
  if (!session) return json({ error: '找不到這個上課時段，請重新整理頁面' }, 404);
  if (!session.open) return json({ error: '這個時段目前未開放報名' }, 409);

  // 同一位學生重複報名同一時段
  const dup = await env.DB.prepare(
    `SELECT id FROM registrations WHERE session_code = ? AND phone = ? AND student_name = ?
     AND status NOT IN ('取消報名', '轉至其他梯次') LIMIT 1`,
  )
    .bind(session.code, input.phone, input.student_name)
    .first<{ id: number }>();
  if (dup) return json({ error: `${input.student_name} 已經報名過這個時段（報名編號 ${dup.id}），如需協助請聯繫講堂` }, 409);

  // 一個 SQL 指令完成「判斷名額 + 寫入」，D1 依序執行，同時多人報名也不會超收
  const now = nowIso();
  const deadline = paymentDeadline();
  // 應繳金額以伺服器時間判斷是否在早鳥期間（家長送來的金額一律不採用）
  const price = priceFor(session, new Date(now));
  const reg = await env.DB.prepare(
    `WITH decision AS (
       SELECT CASE WHEN (SELECT COUNT(*) FROM registrations WHERE session_code = ?1 AND ${holdsSeatSql('?12')}) < ?13
              THEN '正取' ELSE '候補' END AS adm
     )
     INSERT INTO registrations (session_code, course_id, course_title, session_name, student_name, parent_name,
       school, grade, phone, email, note, gender, tel, zip, address, diet, agreed_policies, early_bird_discount,
       admission, status, amount, va_expires_at, created_at, updated_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?16, ?17, ?18, ?19, ?20, ?21, ?22, adm,
       CASE adm WHEN '正取' THEN '等待付費' ELSE '待處理' END,
       ?14,
       CASE adm WHEN '正取' THEN ?15 ELSE NULL END,
       ?12, ?12
     FROM decision
     RETURNING *`,
  )
    .bind(
      session.code, session.course_id, session.course_title, session.name,
      input.student_name, input.parent_name, input.school || null, input.grade || null,
      input.phone, input.email, input.note || null,
      now, session.capacity, price.amount, deadline,
      input.gender, input.tel || null, input.zip, input.address, input.diet || null, agreedPolicies(session), price.earlyBirdDiscount,
    )
    .first<Registration>();
  if (!reg) return json({ error: '報名失敗，請稍後再試' }, 500);

  // 正取：產生繳費帳號（帳號依報名編號計算，所以在寫入後才能產生）
  if (reg.admission === '正取') {
    reg.va_account = generateVirtualAccount(env, reg.id, reg.amount, reg.va_expires_at!);
    await env.DB.prepare('UPDATE registrations SET va_account = ? WHERE id = ?').bind(reg.va_account, reg.id).run();
  }

  // 候補順位
  let waitlistPosition: number | null = null;
  if (reg.admission === '候補') {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM registrations WHERE session_code = ? AND admission = '候補'
       AND status NOT IN ('取消報名', '轉至其他梯次') AND id <= ?`,
    )
      .bind(session.code, reg.id)
      .first<{ n: number }>();
    waitlistPosition = row?.n ?? null;
  }

  // 通知在背景處理，不讓家長等待
  ctx.waitUntil(notifyRegistered(env, reg, waitlistPosition, session).catch((err) => console.error('通知失敗', err)));

  return json({
    id: reg.id,
    admission: reg.admission,
    waitlist_position: waitlistPosition,
    course_title: reg.course_title,
    session_name: reg.session_name,
    session_time: session.time,
    student_name: reg.student_name,
    amount: reg.amount,
    early_bird_discount: reg.early_bird_discount,
    va_account: reg.va_account,
    va_expires_at: reg.va_expires_at,
    test_mode: env.PAYMENT_MODE !== 'live',
  });
}
