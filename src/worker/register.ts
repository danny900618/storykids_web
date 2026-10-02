// 前台 API：剩餘名額查詢、線上報名
import type { Env, Registration } from './env';
import { holdsSeatSql, json, nowIso, paymentDeadline } from './env';
import { countBySession, findSession, loadSessions } from './sessions';
import { generateVirtualAccount } from './payment';
import { notifyRegistered } from './notify';

// GET /api/availability：各時段名額、已報名、剩餘名額、候補人數
export async function handleAvailability(request: Request, env: Env): Promise<Response> {
  const [sessions, counts] = await Promise.all([loadSessions(env, request), countBySession(env)]);
  const data: Record<string, { capacity: number; remaining: number; waitlist: number; open: boolean }> = {};
  for (const s of sessions) {
    const c = counts.get(s.code);
    const taken = c?.taken ?? 0;
    data[s.code] = { capacity: s.capacity, remaining: Math.max(0, s.capacity - taken), waitlist: c?.waitlist ?? 0, open: s.open };
  }
  return json(data);
}

interface RegisterInput {
  session_code?: string;
  student_name?: string;
  parent_name?: string;
  school?: string;
  grade?: string;
  phone?: string;
  email?: string;
  note?: string;
  agree?: boolean;
  website?: string; // 防機器人欄位（畫面上隱藏），有填就是機器人
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// POST /api/register：線上報名
export async function handleRegister(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!request.headers.get('Content-Type')?.includes('application/json')) return json({ error: '格式錯誤' }, 415);
  const body = (await request.json().catch(() => null)) as RegisterInput | null;
  if (!body) return json({ error: '格式錯誤' }, 400);
  if (body.website) return json({ error: '報名失敗' }, 400);

  const input = {
    session_code: clean(body.session_code, 60),
    student_name: clean(body.student_name, 30),
    parent_name: clean(body.parent_name, 30),
    school: clean(body.school, 50),
    grade: clean(body.grade, 20),
    phone: clean(body.phone, 20).replace(/[\s-]/g, ''),
    email: clean(body.email, 100),
    note: clean(body.note, 500),
  };

  // 欄位檢查
  const errors: string[] = [];
  if (!input.student_name) errors.push('請填寫學生姓名');
  if (!input.parent_name) errors.push('請填寫家長姓名');
  if (!/^09\d{8}$/.test(input.phone)) errors.push('請填寫正確的手機號碼（09 開頭共 10 碼）');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) errors.push('請填寫正確的 Email');
  if (body.agree !== true) errors.push('請勾選同意個人資料使用說明');
  if (errors.length) return json({ error: errors.join('、') }, 400);

  const session = await findSession(env, request, input.session_code);
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
  const reg = await env.DB.prepare(
    `WITH decision AS (
       SELECT CASE WHEN (SELECT COUNT(*) FROM registrations WHERE session_code = ?1 AND ${holdsSeatSql('?12')}) < ?13
              THEN '正取' ELSE '候補' END AS adm
     )
     INSERT INTO registrations (session_code, course_id, course_title, session_name, student_name, parent_name,
       school, grade, phone, email, note, admission, status, amount, va_expires_at, created_at, updated_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, adm,
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
      now, session.capacity, session.price, deadline,
    )
    .first<Registration>();
  if (!reg) return json({ error: '報名失敗，請稍後再試' }, 500);

  // 正取：產生繳費帳號（帳號依報名編號計算，所以在寫入後才能產生）
  if (reg.admission === '正取') {
    reg.va_account = generateVirtualAccount(reg.id);
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
  ctx.waitUntil(notifyRegistered(env, reg, waitlistPosition).catch((err) => console.error('通知失敗', err)));

  return json({
    id: reg.id,
    admission: reg.admission,
    waitlist_position: waitlistPosition,
    course_title: reg.course_title,
    session_name: reg.session_name,
    session_time: session.time,
    student_name: reg.student_name,
    amount: reg.amount,
    va_account: reg.va_account,
    va_expires_at: reg.va_expires_at,
    test_mode: env.PAYMENT_MODE !== 'live',
  });
}
