// 報名管理後台 API（/api/admin/*，已通過登入驗證才會進來）
import type { Env, Registration } from './env';
import { LEGACY_PREFIX, STATUSES, formatTw, isExpired, json, nowIso, paymentDeadline } from './env';
import { PROFILE_LABELS, readProfile, validateProfile } from './profile';
import { checkHealth } from './health';
import { countBySession, findSession, loadSessions } from './sessions';
import { PAID_STATUSES, generateVirtualAccount, reconcile } from './payment';
import { notifyPromoted, parseAddress, sendTestEmail, sendTestSms } from './notify';

export async function handleAdmin(request: Request, env: Env, actor: string): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin/, '');
  const method = request.method;

  if (method === 'GET' && path === '/config') {
    await logEntry(env, actor);
    return json({
      actor,
      env_label: env.ENV_LABEL ?? '',
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
  if (method === 'GET' && path === '/registrations') return listRegistrations(env, url.searchParams);
  if (method === 'GET' && path === '/export.csv') return exportCsv(env, url.searchParams, actor);
  if (method === 'GET' && path === '/audit') return listAudit(env, url.searchParams);
  if (method === 'GET' && path === '/bank-files') return listBankFiles(env);
  // 系統健康檢查（不寄信，只回傳目前的問題）
  if (method === 'GET' && path === '/health') return json({ issues: await checkHealth(env) });

  const m = path.match(/^\/registrations\/(\d+)(\/[a-z-]+)?$/);
  if (m) {
    const id = Number(m[1]);
    const action = m[2] ?? '';
    if (method === 'GET' && action === '/history') return history(env, id);
    if (method === 'PATCH' && action === '') return updateRegistration(request, env, id, actor);
    if (method === 'PATCH' && action === '/profile') return updateProfile(request, env, id, actor);
    if (method === 'POST' && action === '/mock-payment') return mockPayment(request, env, id, actor);
    if (method === 'POST' && action === '/delete') return deleteRegistration(request, env, id, actor);
    if (method === 'POST' && action === '/restore') return restoreRegistration(request, env, id, actor);
  }
  return json({ error: '找不到' }, 404);
}

// 各時段報名概況
async function listSessions(request: Request, env: Env): Promise<Response> {
  const [sessions, counts] = await Promise.all([loadSessions(env, request), countBySession(env)]);
  // CMS 已刪除、但資料庫還有報名的時段也要列出，避免報名「消失」
  const known = new Set(sessions.map((s) => s.code));
  // 只有還有「有效」報名（不是取消、轉梯次、已刪除）的時段才警告：報名都已妥善處理的時段刪掉不會警告
  // 舊站匯入的時段本來就不在 CMS，不列入（另外依梯次列出）
  const { results: active } = await env.DB.prepare(
    `SELECT DISTINCT session_code FROM registrations
     WHERE deleted_at IS NULL AND status NOT IN ('取消報名', '轉至其他梯次') AND legacy_term IS NULL`,
  ).all<{ session_code: string }>();
  const orphans = active.map((r) => r.session_code).filter((code) => !known.has(code) && !code.startsWith(LEGACY_PREFIX));
  const { results: legacyTerms } = await env.DB.prepare(
    `SELECT legacy_term AS term, COUNT(*) AS n FROM registrations WHERE legacy_term IS NOT NULL AND deleted_at IS NULL GROUP BY legacy_term ORDER BY legacy_term DESC`,
  ).all<{ term: string; n: number }>();
  return json({
    sessions: sessions.map((s) => ({ ...s, taken: counts.get(s.code)?.taken ?? 0, waitlist: counts.get(s.code)?.waitlist ?? 0 })),
    orphans,
    legacy_terms: legacyTerms,
  });
}

// 報名列表（分頁）：limit／offset；總筆數放在 X-Total-Count（回應本體維持陣列）
async function listRegistrations(env: Env, params: URLSearchParams): Promise<Response> {
  const limit = Math.min(Math.max(Number(params.get('limit')) || 3000, 1), 3000);
  const offset = Math.max(Number(params.get('offset')) || 0, 0);
  const { where, binds } = registrationFilters(params);
  const [rows, total] = await Promise.all([
    queryRegistrations(env, params, limit, offset),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM registrations ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`).bind(...binds).first<{ n: number }>(),
  ]);
  return json(rows, 200, { 'X-Total-Count': String(total?.n ?? rows.length) });
}

async function queryRegistrations(env: Env, params: URLSearchParams, limit = 3000, offset = 0): Promise<(Registration & { expired: boolean })[]> {
  const { where, binds } = registrationFilters(params);
  // 排序：新網站的報名在最上面（最新的在前），舊站匯入的資料排在後面（依上課日期新到舊）
  // 不能只用 id 排序：舊站資料是後來才匯入的，id 比匯入前的報名大
  const sql = `SELECT * FROM registrations ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY (legacy_term IS NOT NULL), created_at DESC, id DESC LIMIT ? OFFSET ?`;
  const { results } = await env.DB.prepare(sql).bind(...binds, limit, offset).all<Registration>();
  return results.map((r) => ({ ...r, expired: isExpired(r) }));
}

// 篩選條件（列表、筆數、匯出共用）
function registrationFilters(params: URLSearchParams): { where: string[]; binds: unknown[] } {
  const where: string[] = [];
  const binds: unknown[] = [];
  const session = params.get('session');
  const admission = params.get('admission');
  const status = params.get('status');
  const q = params.get('q')?.trim();
  const term = params.get('term');
  if (session) { where.push('session_code = ?'); binds.push(session); }
  // 來源：new = 新網站報名；legacy = 舊站匯入（可再指定梯次）
  if (params.get('source') === 'new') where.push('legacy_term IS NULL');
  if (params.get('source') === 'legacy') where.push('legacy_term IS NOT NULL');
  if (term) { where.push('legacy_term = ?'); binds.push(term); }
  if (admission) { where.push('admission = ?'); binds.push(admission); }
  // 已刪除（誤報名）的報名預設不顯示，狀態篩選選「已刪除」才看得到
  where.push(status === '已刪除' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL');
  if (status === '已刪除') {
    // 只用上面的條件
  } else if (status === '逾期未繳') { where.push(`status = '等待付費' AND va_expires_at < ?`); binds.push(nowIso()); }
  else if (status === '需人工確認') { where.push('review_note IS NOT NULL'); }
  else if (status) { where.push('status = ?'); binds.push(status); }
  if (q) {
    where.push(`(student_name LIKE ? OR parent_name LIKE ? OR phone LIKE ? OR tel LIKE ? OR email LIKE ? OR va_account LIKE ? OR legacy_va LIKE ?
      OR school LIKE ? OR course_title LIKE ? OR CAST(id AS TEXT) = ?)`);
    const like = `%${q}%`;
    binds.push(like, like, like, like, like, like, like, like, like, q);
  }
  return { where, binds };
}

// 修改狀態 / 正取候補
async function updateRegistration(request: Request, env: Env, id: number, actor: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { status?: string; admission?: string };
  const reg = await env.DB.prepare('SELECT * FROM registrations WHERE id = ?').bind(id).first<Registration>();
  if (!reg) return json({ error: '找不到這筆報名' }, 404);
  if (reg.deleted_at) return json({ error: '這筆報名已刪除，請先復原再修改' }, 400);

  const now = nowIso();
  const changes: string[] = [];
  const next = { ...reg };

  // 候補 → 正取（遞補）：產生繳費帳號、重新計算繳費期限、通知家長
  let promoted = false;
  if (body.admission && body.admission !== reg.admission) {
    // 舊站匯入的資料沒有對應的 CMS 時段，不能遞補（避免產生新繳費帳號、通知家長）
    if (reg.legacy_term) return json({ error: '舊站匯入的報名不能修改正取／候補' }, 400);
    if (body.admission === '正取') {
      next.admission = '正取';
      next.status = '等待付費';
      // 繳款截止日編在帳號裡：遞補時依新的期限重新產生帳號
      next.va_expires_at = paymentDeadline();
      next.va_account = generateVirtualAccount(env, reg.id, reg.amount, next.va_expires_at);
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

// 編輯報名資料（家長填錯電話等）與優待金額
// 優待金額只做顯示，不改應繳金額（amount），已產生的繳費帳號與對帳金額不受影響
async function updateProfile(request: Request, env: Env, id: number, actor: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: '格式錯誤' }, 400);
  const reg = await env.DB.prepare('SELECT * FROM registrations WHERE id = ?').bind(id).first<Registration>();
  if (!reg) return json({ error: '找不到這筆報名' }, 404);
  if (reg.deleted_at) return json({ error: '這筆報名已刪除，請先復原再修改' }, 400);

  const profile = readProfile(body);
  // 原本就不合格式的欄位（多為舊站資料）沒有修改就不擋，只檢查這次改的欄位
  const errors = validateProfile(profile, 'admin', readProfile(reg as unknown as Record<string, unknown>)); // 原資料用同樣規則整理後再比對
  let discount: number | null = null;
  if (body.discount_amount !== undefined && body.discount_amount !== null && body.discount_amount !== '') {
    discount = Number(body.discount_amount);
    if (!Number.isInteger(discount) || discount < 0 || discount > 1_000_000) errors.push('優待金額請填 0 以上的整數');
  }
  if (errors.length) return json({ error: errors.join('、') }, 400);

  // 只記錄有變動的欄位
  const changes: string[] = [];
  const next: Record<string, string | number | null> = {};
  for (const key of Object.keys(PROFILE_LABELS) as (keyof typeof PROFILE_LABELS)[]) {
    const value = profile[key] || null;
    const before = (reg[key] as string | null) || null;
    if (value === before) continue;
    if (key === 'student_name' || key === 'parent_name' || key === 'phone' || key === 'email') next[key] = value ?? '';
    else next[key] = value;
    changes.push(`${PROFILE_LABELS[key]}：${before ?? '（空白）'} → ${value ?? '（空白）'}`);
  }
  if (discount !== reg.discount_amount) {
    next.discount_amount = discount;
    changes.push(`優待金額：${reg.discount_amount ?? '（空白）'} → ${discount ?? '（空白）'}`);
  }
  if (!changes.length) return json({ ...reg, expired: isExpired(reg) });

  const now = nowIso();
  const cols = Object.keys(next);
  await env.DB.batch([
    env.DB.prepare(`UPDATE registrations SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(
      ...cols.map((c) => next[c]), now, id,
    ),
    env.DB.prepare(`INSERT INTO audit_log (registration_id, actor, action, detail, created_at) VALUES (?, ?, '編輯資料', ?, ?)`).bind(
      id, actor, changes.join('；'), now,
    ),
  ]);
  const updated = { ...reg, ...next, updated_at: now } as Registration;
  return json({ ...updated, expired: isExpired(updated) });
}

// 刪除（誤報名）：軟刪除，從列表隱藏、釋放名額、不通知家長；紀錄保留可復原
// 已繳費或已有入帳紀錄的不能刪除（要改「取消報名」並處理退款）
// 繳費帳號在截止日前仍可轉入：之後若有入帳，對帳會標記「需人工確認」
async function deleteRegistration(request: Request, env: Env, id: number, actor: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
  if (!reason) return json({ error: '請填寫刪除原因' }, 400);
  const reg = await env.DB.prepare('SELECT * FROM registrations WHERE id = ?').bind(id).first<Registration>();
  if (!reg) return json({ error: '找不到這筆報名' }, 404);
  if (reg.deleted_at) return json({ error: '這筆報名已經刪除' }, 400);
  const payments = await env.DB.prepare('SELECT COUNT(*) AS n FROM payment_events WHERE registration_id = ?').bind(id).first<{ n: number }>();
  if (PAID_STATUSES.includes(reg.status) || reg.paid_at || (payments?.n ?? 0) > 0) {
    return json({ error: '這筆報名已有繳費或入帳紀錄，不能刪除；請改用「取消報名」並處理退款' }, 400);
  }
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE registrations SET deleted_at = ?, deleted_by = ?, delete_reason = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').bind(now, actor, reason, now, id),
    env.DB.prepare(`INSERT INTO audit_log (registration_id, actor, action, detail, created_at) VALUES (?, ?, '刪除報名', ?, ?)`).bind(
      id, actor, `原因：${reason}（${reg.admission}／${reg.status}${reg.va_account ? `，繳費帳號 ${reg.va_account}` : ''}）`, now,
    ),
  ]);
  return json({ ok: true });
}

// 復原已刪除的報名；正取要確認時段還有名額（刪除期間名額可能已被別人報走）
async function restoreRegistration(request: Request, env: Env, id: number, actor: string): Promise<Response> {
  const reg = await env.DB.prepare('SELECT * FROM registrations WHERE id = ?').bind(id).first<Registration>();
  if (!reg) return json({ error: '找不到這筆報名' }, 404);
  if (!reg.deleted_at) return json({ error: '這筆報名沒有被刪除' }, 400);
  const session = reg.legacy_term ? undefined : await findSession(env, request, reg.session_code);
  if (session && reg.admission === '正取' && !['取消報名', '轉至其他梯次'].includes(reg.status)) {
    const taken = (await countBySession(env)).get(reg.session_code)?.taken ?? 0;
    if (taken >= session.capacity) return json({ error: '這個時段目前名額已滿，無法以正取復原；請先調整其他報名或增加名額' }, 409);
  }
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE registrations SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, updated_at = ? WHERE id = ?').bind(now, id),
    env.DB.prepare(`INSERT INTO audit_log (registration_id, actor, action, detail, created_at) VALUES (?, ?, '復原報名', ?, ?)`).bind(
      id, actor, `原刪除原因：${reg.delete_reason ?? ''}`, now,
    ),
  ]);
  return json({ ok: true });
}

// 模擬入帳（只在測試模式可用）：走跟台新入帳通知完全相同的對帳流程
async function mockPayment(request: Request, env: Env, id: number, actor: string): Promise<Response> {
  if (env.PAYMENT_MODE !== 'mock') return json({ error: '正式模式不能模擬入帳' }, 403);
  // 可指定金額（測試金額不符）；未指定則用應繳金額
  const body = (await request.json().catch(() => ({}))) as { amount?: unknown };
  const reg = await env.DB.prepare('SELECT * FROM registrations WHERE id = ?').bind(id).first<Registration>();
  if (!reg?.va_account) return json({ error: '這筆報名沒有繳費帳號（候補不會產生帳號）' }, 400);
  const amount = Number.isInteger(body.amount) ? (body.amount as number) : reg.amount;
  await audit(env, id, actor, '模擬入帳', `模擬入帳 ${amount} 元`);
  const out = await reconcile(env, {
    ref: `MOCK-${id}-${Date.now()}`,
    vaAccount: reg.va_account,
    amount,
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
async function exportCsv(env: Env, params: URLSearchParams, actor: string): Promise<Response> {
  const rows = await queryRegistrations(env, params);
  const filters = [...params.entries()].map(([k, v]) => `${k}=${v}`).join('、') || '全部';
  await audit(env, null, actor, '匯出名單', `條件：${filters}；共 ${rows.length} 筆`);
  const header = ['報名編號', '報名時間', '來源', '課程', '時段', '時段代號', '正取/候補', '狀態', '學生姓名', '性別', '家長姓名', '學校', '年級',
    '行動電話', '聯絡電話', 'Email', '郵遞區號', '地址', '飲食習慣', '備註', '應繳金額', '早鳥折扣', '優待金額', '繳費帳號', '繳費期限', '入帳金額', '入帳時間', '同意辦法', '需人工確認'];
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    // 避免 Excel 公式注入：開頭為 = + - @ 的欄位前加單引號
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = rows.map((r) =>
    [
      r.id, r.legacy_term ? '' : formatTw(r.created_at), r.legacy_term ? `舊站 ${r.legacy_term} #${r.legacy_id}` : '新網站',
      r.course_title, r.session_name, r.legacy_term ? '' : r.session_code, r.admission,
      r.expired ? '等待付費（已逾期）' : r.status,
      r.student_name, r.gender, r.parent_name, r.school, r.grade, `\t${r.phone}`, r.tel ? `\t${r.tel}` : '', r.email, r.zip, r.address, r.diet, r.note,
      r.legacy_term ? '' : r.amount, r.early_bird_discount, r.discount_amount,
      r.va_account || r.legacy_va ? `\t${r.va_account ?? r.legacy_va}` : '', formatTw(r.va_expires_at), r.paid_amount, formatTw(r.paid_at), r.agreed_policies, r.review_note,
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

async function audit(env: Env, registrationId: number | null, actor: string, action: string, detail: string) {
  await env.DB.prepare(`INSERT INTO audit_log (registration_id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(registrationId, actor, action, detail, nowIso())
    .run();
}

// 進入後台：同一位使用者 30 分鐘內只記一次，避免紀錄被重新整理洗版
async function logEntry(env: Env, actor: string) {
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  const recent = await env.DB.prepare(`SELECT id FROM audit_log WHERE actor = ? AND action = '進入後台' AND created_at > ? LIMIT 1`)
    .bind(actor, since)
    .first();
  if (!recent) await audit(env, null, actor, '進入後台', '開啟報名管理後台');
}

// 操作紀錄列表（新到舊），可依使用者篩選；before = 上一頁最後一筆的 id（載入更多）
async function listAudit(env: Env, params: URLSearchParams): Promise<Response> {
  const where: string[] = [];
  const binds: unknown[] = [];
  const actor = params.get('actor');
  const before = Number(params.get('before'));
  if (actor) { where.push('a.actor = ?'); binds.push(actor); }
  if (Number.isInteger(before) && before > 0) { where.push('a.id < ?'); binds.push(before); }
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 200);
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.registration_id, a.actor, a.action, a.detail, a.created_at,
            r.student_name, r.course_title, r.session_name
     FROM audit_log a LEFT JOIN registrations r ON r.id = a.registration_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY a.id DESC LIMIT ${limit}`,
  )
    .bind(...binds)
    .all();
  const actors = await env.DB.prepare('SELECT DISTINCT actor FROM audit_log ORDER BY actor').all<{ actor: string }>();
  return json({ items: results, actors: actors.results.map((r) => r.actor) });
}

// 台新銷帳檔列表（新到舊，不含檔案內容）
async function listBankFiles(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT id, filename, sha256, size, received_at, status, note, processed_at FROM bank_files ORDER BY id DESC LIMIT 200',
  ).all();
  return json({ items: results });
}
