// 金流：台新虛擬帳號與自動對帳
// 帳號依台新公式 5 產生（taishin.ts）；入帳資料來自台新 sFTP 銷帳檔（bank-files.ts），一律經過 reconcile()
// 測試模式（PAYMENT_MODE = mock）：檢查碼故意算錯，銀行會拒絕轉帳，避免測試帳號真的收到錢；後台可按「模擬入帳」測試
import type { Env, Registration } from './env';
import { nowIso } from './env';
import { notifyPaid, notifyReviewNeeded } from './notify';
import { buildVirtualAccount } from './taishin';

// 已完成繳費的狀態
export const PAID_STATUSES = ['已付費', '合庫轉帳', '現金繳清'];

// 虛擬帳號：96989 ＋ 報名編號後 4 碼 ＋ 繳款截止日（民國年尾數＋年中第幾天）＋ 檢查碼（含金額）
// 截止日與金額都編在帳號裡：遞補或改期限時要重新產生帳號
export function generateVirtualAccount(env: Env, registrationId: number, amount: number, deadlineIso: string): string {
  const va = buildVirtualAccount(registrationId, deadlineIso, amount);
  if (env.PAYMENT_MODE === 'live') return va;
  // 測試模式：檢查碼 +5，格式看起來一樣，但銀行檢核不會通過
  return `${va.slice(0, 13)}${(Number(va[13]) + 5) % 10}`;
}

export type ReconcileResult =
  | 'paid' // 對帳成功，已改為已付費
  | 'paid_late' // 逾期後才入帳：名額可能已釋出，轉人工確認
  | 'amount_mismatch' // 金額不符：轉人工確認
  | 'unmatched' // 查無此帳號
  | 'already_paid' // 這筆報名已經繳過費
  | 'not_payable' // 報名已取消／轉梯次／候補：轉人工確認（可能需退費）
  | 'legacy' // 轉入舊站報名的繳費帳號：舊站資料沒有金額，轉人工確認
  | 'duplicate_event'; // 同一筆入帳通知重送，已處理過

// 入帳對帳：台新入帳通知、排程對帳、「模擬入帳」共用
// ref = 銀行交易序號，同一筆通知重送時不會重複處理
export async function reconcile(
  env: Env,
  input: { ref: string; vaAccount: string; amount: number; raw?: string },
): Promise<{ result: ReconcileResult; registration?: Registration }> {
  const now = nowIso();
  // 新系統帳號找不到時，再比對舊站匯入的帳號（舊站停用前後，家長可能仍轉入舊帳號）
  const reg =
    (await env.DB.prepare('SELECT * FROM registrations WHERE va_account = ?').bind(input.vaAccount).first<Registration>()) ??
    (await env.DB.prepare('SELECT * FROM registrations WHERE legacy_va = ? ORDER BY id DESC LIMIT 1').bind(input.vaAccount).first<Registration>());

  let result: ReconcileResult;
  let review: string | null = null;
  if (!reg) {
    result = 'unmatched';
  } else if (reg.legacy_term) {
    result = 'legacy';
    review = `轉入舊站報名（${reg.legacy_term}）的繳費帳號 ${input.amount} 元，舊站資料沒有應繳金額，請確認後手動更新狀態`;
  } else if (PAID_STATUSES.includes(reg.status)) {
    result = 'already_paid';
    review = `重複繳費：已於 ${reg.paid_at ?? '先前'} 繳清，又收到 ${input.amount} 元（可能需退費）`;
  } else if (reg.admission !== '正取' || ['取消報名', '轉至其他梯次'].includes(reg.status)) {
    result = 'not_payable';
    review = `報名狀態為「${reg.admission}／${reg.status}」時收到 ${input.amount} 元，請確認是否保留名額或退費`;
  } else if (input.amount !== reg.amount) {
    result = 'amount_mismatch';
    review = `入帳金額不符：應繳 ${reg.amount} 元，實收 ${input.amount} 元`;
  } else if (reg.va_expires_at && reg.va_expires_at < now) {
    result = 'paid_late';
    review = `逾期後才入帳（期限 ${reg.va_expires_at}），名額可能已釋出給其他人，請確認是否保留或退費`;
  } else {
    result = 'paid';
  }

  // 先寫入帳紀錄；ref 重複代表這筆通知已處理過
  const inserted = await env.DB.prepare(
    `INSERT INTO payment_events (ref, va_account, amount, registration_id, result, raw, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (ref) DO NOTHING`,
  )
    .bind(input.ref, input.vaAccount, input.amount, reg?.id ?? null, result, input.raw ?? null, now)
    .run();
  if (inserted.meta.changes === 0) return { result: 'duplicate_event', registration: reg ?? undefined };
  if (!reg) return { result };

  if (result === 'paid') {
    // 條件式更新：只有「等待付費、未逾期」的報名會被改成已付費，避免併發時重複處理
    const updated = await env.DB.prepare(
      `UPDATE registrations SET status = '已付費', paid_amount = ?, paid_at = ?, review_note = NULL, updated_at = ?
       WHERE id = ? AND status NOT IN ('已付費', '現金繳清', '合庫轉帳')`,
    )
      .bind(input.amount, now, now, reg.id)
      .run();
    if (updated.meta.changes === 0) {
      // 併發：另一筆通知已先完成付款
      await env.DB.prepare(`UPDATE payment_events SET result = 'already_paid' WHERE ref = ?`).bind(input.ref).run();
      return { result: 'already_paid', registration: reg };
    }
    const paid: Registration = { ...reg, status: '已付費', paid_amount: input.amount, paid_at: now, review_note: null };
    await audit(env, reg.id, '自動對帳', `入帳 ${input.amount} 元（交易序號 ${input.ref}）`, now);
    await notifyPaid(env, paid);
    return { result, registration: paid };
  }

  // 其他情況：不自動改成已付費，記錄實收金額並標記「需人工確認」，通知公司信箱
  const flagged: Registration = {
    ...reg,
    paid_amount: (reg.paid_amount ?? 0) + input.amount,
    paid_at: reg.paid_at ?? now,
    review_note: review,
  };
  await env.DB.prepare(`UPDATE registrations SET paid_amount = ?, paid_at = ?, review_note = ?, updated_at = ? WHERE id = ?`)
    .bind(flagged.paid_amount, flagged.paid_at, review, now, reg.id)
    .run();
  await audit(env, reg.id, '入帳需人工確認', `${review}（交易序號 ${input.ref}）`, now);
  await notifyReviewNeeded(env, flagged);
  return { result, registration: flagged };
}

async function audit(env: Env, registrationId: number, action: string, detail: string, now: string) {
  await env.DB.prepare(`INSERT INTO audit_log (registration_id, actor, action, detail, created_at) VALUES (?, 'system', ?, ?, ?)`)
    .bind(registrationId, action, detail, now)
    .run();
}

// 銀行沖正（銷帳檔「負號」，表示支取）：不自動改狀態，記錄並標記需人工確認
export async function recordReversal(env: Env, input: { ref: string; vaAccount: string; amount: number; raw?: string }): Promise<'reversal' | 'duplicate_event'> {
  const now = nowIso();
  const reg =
    (await env.DB.prepare('SELECT * FROM registrations WHERE va_account = ?').bind(input.vaAccount).first<Registration>()) ??
    (await env.DB.prepare('SELECT * FROM registrations WHERE legacy_va = ? ORDER BY id DESC LIMIT 1').bind(input.vaAccount).first<Registration>());
  const inserted = await env.DB.prepare(
    `INSERT INTO payment_events (ref, va_account, amount, registration_id, result, raw, created_at)
     VALUES (?, ?, ?, ?, 'reversal', ?, ?) ON CONFLICT (ref) DO NOTHING`,
  )
    .bind(input.ref, input.vaAccount, -input.amount, reg?.id ?? null, input.raw ?? null, now)
    .run();
  if (inserted.meta.changes === 0) return 'duplicate_event';
  if (reg) {
    const review = `銀行沖正（支取）${input.amount} 元，請確認這筆繳費是否有效`;
    await env.DB.prepare('UPDATE registrations SET review_note = ?, updated_at = ? WHERE id = ?').bind(review, now, reg.id).run();
    await audit(env, reg.id, '入帳需人工確認', `${review}（交易序號 ${input.ref}）`, now);
    await notifyReviewNeeded(env, { ...reg, review_note: review });
  }
  return 'reversal';
}
