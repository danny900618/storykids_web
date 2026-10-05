// 報名管理後台 API（/api/admin/*，已通過登入驗證才會進來）
import type { Env, Registration } from './env';
import { STATUSES, formatTw, isExpired, json, nowIso, paymentDeadline } from './env';
import { countBySession, findSession, loadSessions } from './sessions';
import { PAID_STATUSES, generateVirtualAccount, reconcile } from './payment';
import { notifyPromoted, parseAddress, sendTestEmail, sendTestSms } from './notify';

export async function handleAdmin(request: Request, env: Env, actor: string): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin/, '');
  const method = request.method;

  if (method === 'GET' && path === '/config') {
    return json({
      actor,
      payment_mode: env.PAYMENT_MODE,
      mail_mode: env.MAIL_MODE,
      sms_mode: env.SMS_MODE,
      company_email: env.COMPANY_EMAIL,
      mail_ready: !!env.BREVO_API_KEY,
      sms_ready: !!(env.MITAKE_USERNAME && env.MITAKE_PASSWORD),
      sms_points: await latestSmsPoints(env),
      statuses: STATUSES,
    });
  }

  if (method === 'POST' && path === '/test-email') return testEmail(request, env, actor);
  if (method === 'POST' && path === '/test-sms') return testSms(request, env, actor);
  if (method === 'GET' && path === '/sessions') return listSessions(request, env);
  if (method === 'GET' && path === '/registrations') return json(await queryRegistrations(env, url.searchParams));
  if (method === 'GET' && path === '/export.csv') return exportCsv(env, url.searchParams);

  const m = path.match(/^\/registrations\/(\d+)(\/[a-z-]+)?$/);
  if (m) {
    const id = Number(m[1]);
    const action = m[2] ?? '';
    if (method === 'GET' && action === '/history') return history(env, id);
    if (method === 'PATCH' && action === '') return updateRegistration(request, env, id, actor);
    if (method === 'POST' && action === '/mock-payment') return mockPayment(request, env, id, actor);
  }
  return json({ error: '找不到' }, 404);
}

// 各時段報名概況
async function listSessions(request: Request, env: Env): Promise<Response> {
  const [sessions, counts] = await Promise.all([loadSessions(env, request), countBySession(env)]);
  // CMS 已刪除、但資料庫還有報名的時段也要列出，避免報名「消失」
  const known = new Set(sessions.map((s) => s.code));
  const orphans = [...counts.keys()].filter((code) => !known.has(code));
  return json({
    sessions: sessions.map((s) => ({ ...s, taken: counts.get(s.code)?.taken ?? 0, waitlist: counts.get(s.code)?.waitlist ?? 0 })),
    orphans,
  });
}

async function queryRegistrations(env: Env, params: URLSearchParams): Promise<(Registration & { expired: boolean })[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  const session = params.get('session');
  const admission = params.get('admission');
  const status = params.get('status');
  const q = params.get('q')?.trim();
  if (session) { where.push('session_code = ?'); binds.push(session); }
  if (admission) { where.push('admission = ?'); binds.push(admission); }
  if (status === '逾期未繳') { where.push(`status = '等待付費' AND va_expires_at < ?`); binds.push(nowIso()); }
  else if (status === '需人工確認') { where.push('review_note IS NOT NULL'); }
  else if (status) { where.push('status = ?'); binds.push(status); }
  if (q) {
    where.push('(student_name LIKE ? OR parent_name LIKE ? OR phone LIKE ? OR email LIKE ? OR va_account LIKE ? OR CAST(id AS TEXT) = ?)');
    const like = `%${q}%`;
    binds.push(like, like, like, like, like, q);
  }
  const sql = `SELECT * FROM registrations ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 1000`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all<Registration>();
  return results.map((r) => ({ ...r, expired: isExpired(r) }));
}

// 修改狀態 / 正取候補
async function updateRegistration(request: Request, env: Env, id: number, actor: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { status?: string; admission?: string };
  const reg = await env.DB.prepare('SELECT * FROM registrations WHERE id = ?').bind(id).first<Registration>();
  if (!reg) return json({ error: '找不到這筆報名' }, 404);

  const now = nowIso();
  const changes: string[] = [];
  const next = { ...reg };

  // 候補 → 正取（遞補）：產生繳費帳號、重新計算繳費期限、通知家長
  let promoted = false;
  if (body.admission && body.admission !== reg.admission) {
    if (body.admission === '正取') {
      next.admission = '正取';
      next.status = '等待付費';
      next.va_account = reg.va_account ?? generateVirtualAccount(reg.id);
      next.va_expires_at = paymentDeadline();
      promoted = true;
      changes.push('候補 → 正取（遞補）');
    } else if (body.admission === '候補') {
      next.admission = '候補';
      next.status = '待處理';
      next.va_expires_at = now; // 讓原繳費帳號立即失效
      changes.push('正取 → 候補');
    } else {
      return json({ error: '錯誤的正取／候補值' }, 400);
    }
  }

  if (body.status && body.status !== next.status) {
    if (!(STATUSES as readonly string[]).includes(body.status)) return json({ error: '錯誤的狀態' }, 400);
    changes.push(`狀態：${next.status} → ${body.status}`);
    next.status = body.status;
    // 手動標記為已繳費（合庫轉帳、現金等）時記錄入帳資訊
    if (PAID_STATUSES.includes(body.status) && !next.paid_at) {
      next.paid_at = now;
      next.paid_amount = next.amount;
    }
  }

  if (!changes.length) return json(reg);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE registrations SET admission = ?, status = ?, va_account = ?, va_expires_at = ?, paid_at = ?, paid_amount = ?, review_note = NULL, updated_at = ? WHERE id = ?`,
    ).bind(next.admission, next.status, next.va_account, next.va_expires_at, next.paid_at, next.paid_amount, now, id),
    env.DB.prepare(`INSERT INTO audit_log (registration_id, actor, action, detail, created_at) VALUES (?, ?, '修改', ?, ?)`).bind(
      id, actor, changes.join('；'), now,
    ),
  ]);

  if (promoted) await notifyPromoted(env, next, await findSession(env, request, next.session_code));
  return json({ ...next, review_note: null, updated_at: now, expired: isExpired(next) });
}

// 模擬入帳（只在測試模式可用）：走跟台新入帳通知完全相同的對帳流程
async function mockPayment(request: Request, env: Env, id: number, actor: string): Promise<Response> {
  if (env.PAYMENT_MODE !== 'mock') return json({ error: '正式模式不能模擬入帳' }, 403);
  // 可指定金額（測試金額不符）；未指定則用應繳金額
  const body = (await request.json().catch(() => ({}))) as { amount?: unknown };
  const reg = await env.DB.prepare('SELECT * FROM registrations WHERE id = ?').bind(id).first<Registration>();
  if (!reg?.va_account) return json({ error: '這筆報名沒有繳費帳號（候補不會產生帳號）' }, 400);
  const out = await reconcile(env, {
    ref: `MOCK-${id}-${Date.now()}`,
    vaAccount: reg.va_account,
    amount: Number.isInteger(body.amount) ? (body.amount as number) : reg.amount,
    raw: JSON.stringify({ mock: true, by: actor }),
  });
  return json(out);
}

// 單筆報名的通知紀錄、入帳紀錄、操作紀錄
async function history(env: Env, id: number): Promise<Response> {
  const [notifications, payments, audit] = await Promise.all([
    env.DB.prepare('SELECT * FROM notifications WHERE registration_id = ? ORDER BY id').bind(id).all(),
    env.DB.prepare('SELECT * FROM payment_events WHERE registration_id = ? ORDER BY id').bind(id).all(),
    env.DB.prepare('SELECT * FROM audit_log WHERE registration_id = ? ORDER BY id').bind(id).all(),
  ]);
  return json({ notifications: notifications.results, payments: payments.results, audit: audit.results });
}

// 匯出 CSV（UTF-8 BOM，Excel 直接開啟不會亂碼）
async function exportCsv(env: Env, params: URLSearchParams): Promise<Response> {
  const rows = await queryRegistrations(env, params);
  const header = ['報名編號', '報名時間', '課程', '時段', '時段代號', '正取/候補', '狀態', '學生姓名', '家長姓名', '學校', '年級', '手機', 'Email', '備註', '應繳金額', '繳費帳號', '繳費期限', '入帳金額', '入帳時間', '需人工確認'];
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    // 避免 Excel 公式注入：開頭為 = + - @ 的欄位前加單引號
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = rows.map((r) =>
    [
      r.id, formatTw(r.created_at), r.course_title, r.session_name, r.session_code, r.admission,
      r.expired ? '等待付費（已逾期）' : r.status,
      r.student_name, r.parent_name, r.school, r.grade, `\t${r.phone}`, r.email, r.note, r.amount,
      r.va_account ? `\t${r.va_account}` : '', formatTw(r.va_expires_at), r.paid_amount, formatTw(r.paid_at), r.review_note,
    ].map(esc).join(','),
  );
  const csv = `﻿${[header.join(','), ...lines].join('\r\n')}`;
  const date = formatTw(nowIso()).slice(0, 10).replace(/\//g, '');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="registrations-${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

// 寄測試信（確認 Brevo 串接與寄件網域設定）
async function testEmail(request: Request, env: Env, actor: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { to?: unknown; from?: unknown; notification_id?: unknown };
  const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  if (!isEmail(to)) return json({ error: '請填寫正確的 Email' }, 400);
  // 寄件人（選填）：可填「名稱 <email>」或只填 email，需先在 Brevo 驗證過
  const from = typeof body.from === 'string' ? body.from.trim() : '';
  if (from && !isEmail(parseAddress(from).email)) return json({ error: '寄件人 Email 格式錯誤' }, 400);
  // 預覽某一封通知信：用系統記錄的同一份內容寄給自己
  let content: { subject: string; body: string; html: string | null } | undefined;
  if (body.notification_id !== undefined) {
    const n = await env.DB.prepare(`SELECT subject, body, html FROM notifications WHERE id = ? AND channel = 'email'`)
      .bind(Number(body.notification_id))
      .first<{ subject: string | null; body: string; html: string | null }>();
    if (!n) return json({ error: '找不到這封通知信' }, 404);
    content = { subject: `［預覽］${n.subject ?? ''}`, body: n.body.replace(/\n\n［寄送失敗］[\s\S]*$/, ''), html: n.html };
  }
  try {
    await sendTestEmail(env, to, { from: from || undefined, content });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : '寄送失敗' }, 502);
  }
  await env.DB.prepare(`INSERT INTO audit_log (registration_id, actor, action, detail, created_at) VALUES (NULL, ?, '寄測試信', ?, ?)`)
    .bind(actor, to, nowIso())
    .run();
  return json({ ok: true });
}

// 發測試簡訊（確認三竹串接；會扣點數）
async function testSms(request: Request, env: Env, actor: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { to?: unknown };
  const to = typeof body.to === 'string' ? body.to.replace(/[\s-]/g, '') : '';
  if (!/^09\d{8}$/.test(to)) return json({ error: '請填寫正確的手機號碼（09 開頭共 10 碼）' }, 400);
  let accountPoint: number | undefined;
  try {
    ({ accountPoint } = await sendTestSms(env, to));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : '發送失敗' }, 502);
  }
  await env.DB.prepare(`INSERT INTO audit_log (registration_id, actor, action, detail, created_at) VALUES (NULL, ?, '發測試簡訊', ?, ?)`)
    .bind(actor, `${to}${accountPoint !== undefined ? `（剩餘點數 ${accountPoint}）` : ''}`, nowIso())
    .run();
  return json({ ok: true, account_point: accountPoint ?? null });
}

// 最近一次發送簡訊時三竹回報的剩餘點數
async function latestSmsPoints(env: Env): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT body FROM notifications WHERE channel = 'sms' AND result = 'sent' AND body LIKE '%［三竹剩餘點數%' ORDER BY id DESC LIMIT 1`,
  ).first<{ body: string }>();
  const m = row?.body.match(/三竹剩餘點數 (\d+)/);
  return m ? Number(m[1]) : null;
}
