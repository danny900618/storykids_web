// 金流：台新虛擬帳號與自動對帳
// 目前為測試模式（PAYMENT_MODE = mock）：產生「看起來像」的假帳號，後台可按「模擬入帳」測試對帳流程。
// 拿到台新規格書後：
//   1. 改寫 generateVirtualAccount()：依台新編碼規則與檢查碼演算法產生帳號
//   2. 實作 /api/taishin/notify（或排程抓對帳檔）：驗證簽章、解密入帳資料後，呼叫 reconcile()
import type { Env, Registration } from './env';
import { nowIso } from './env';
import { notifyPaid, notifyReviewNeeded } from './notify';

// 企業代號（取自舊站繳費說明：96989 開頭、共 14 碼）
const COMPANY_CODE = '96989';

// 已完成繳費的狀態
export const PAID_STATUSES = ['已付費', '合庫轉帳', '現金繳清'];

// 假帳號：96989 + 報名編號 7 碼 + 2 碼假檢查碼 = 14 碼
// ⚠️ 僅供測試，真正的檢查碼演算法要依台新規格書
export function generateVirtualAccount(registrationId: number): string {
  const serial = String(registrationId).padStart(7, '0');
  const check = String((registrationId * 37 + 11) % 97).padStart(2, '0');
  return `${COMPANY_CODE}${serial}${check}`;
}

export type ReconcileResult =
  | 'paid' // 對帳成功，已改為已付費
  | 'paid_late' // 逾期後才入帳：名額可能已釋出，轉人工確認
  | 'amount_mismatch' // 金額不符：轉人工確認
  | 'unmatched' // 查無此帳號
  | 'already_paid' // 這筆報名已經繳過費
  | 'not_payable' // 報名已取消／轉梯次／候補：轉人工確認（可能需退費）
  | 'duplicate_event'; // 同一筆入帳通知重送，已處理過

// 入帳對帳：台新入帳通知、排程對帳、「模擬入帳」共用
// ref = 銀行交易序號，同一筆通知重送時不會重複處理
export async function reconcile(
  env: Env,
  input: { ref: string; vaAccount: string; amount: number; raw?: string },
): Promise<{ result: ReconcileResult; registration?: Registration }> {
  const now = nowIso();
  const reg = await env.DB.prepare('SELECT * FROM registrations WHERE va_account = ?').bind(input.vaAccount).first<Registration>();

  let result: ReconcileResult;
  let review: string | null = null;
  if (!reg) {
    result = 'unmatched';
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
