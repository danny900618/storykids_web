// 金流：台新虛擬帳號與自動對帳
// 目前為測試模式（PAYMENT_MODE = mock）：產生「看起來像」的假帳號，後台可按「模擬入帳」測試對帳流程。
// 拿到台新規格書後：
//   1. 改寫 generateVirtualAccount()：依台新編碼規則與檢查碼演算法產生帳號
//   2. 實作 /api/taishin/notify：驗證簽章、解密入帳資料後，呼叫 reconcile()
import type { Env, Registration } from './env';
import { nowIso } from './env';
import { notifyPaid } from './notify';

// 企業代號（取自舊站繳費說明：96989 開頭、共 14 碼）
const COMPANY_CODE = '96989';

// 假帳號：96989 + 報名編號 7 碼 + 2 碼假檢查碼 = 14 碼
// ⚠️ 僅供測試，真正的檢查碼演算法要依台新規格書
export function generateVirtualAccount(registrationId: number): string {
  const serial = String(registrationId).padStart(7, '0');
  const check = String((registrationId * 37 + 11) % 97).padStart(2, '0');
  return `${COMPANY_CODE}${serial}${check}`;
}

export type ReconcileResult = 'paid' | 'amount_mismatch' | 'unmatched' | 'already_paid' | 'duplicate_event';

// 入帳對帳：台新入帳通知與「模擬入帳」共用
// ref = 銀行交易序號，同一筆通知重送時不會重複入帳
export async function reconcile(
  env: Env,
  input: { ref: string; vaAccount: string; amount: number; raw?: string },
): Promise<{ result: ReconcileResult; registration?: Registration }> {
  const now = nowIso();
  const reg = await env.DB.prepare('SELECT * FROM registrations WHERE va_account = ?').bind(input.vaAccount).first<Registration>();

  let result: ReconcileResult;
  if (!reg) result = 'unmatched';
  else if (['已付費', '現金繳清', '合庫轉帳'].includes(reg.status)) result = 'already_paid';
  else if (input.amount !== reg.amount) result = 'amount_mismatch';
  else result = 'paid';

  // 先寫入帳紀錄；ref 重複代表這筆通知已處理過
  const inserted = await env.DB.prepare(
    `INSERT INTO payment_events (ref, va_account, amount, registration_id, result, raw, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (ref) DO NOTHING`,
  )
    .bind(input.ref, input.vaAccount, input.amount, reg?.id ?? null, result, input.raw ?? null, now)
    .run();
  if (inserted.meta.changes === 0) return { result: 'duplicate_event', registration: reg ?? undefined };

  if (result === 'paid' && reg) {
    // 條件式更新：只有尚未付費的報名會被改成已付費，避免併發時重複處理
    const updated = await env.DB.prepare(
      `UPDATE registrations SET status = '已付費', paid_amount = ?, paid_at = ?, updated_at = ?
       WHERE id = ? AND status NOT IN ('已付費', '現金繳清', '合庫轉帳')`,
    )
      .bind(input.amount, now, now, reg.id)
      .run();
    if (updated.meta.changes > 0) {
      const paid = { ...reg, status: '已付費', paid_amount: input.amount, paid_at: now };
      await env.DB.prepare(
        `INSERT INTO audit_log (registration_id, actor, action, detail, created_at) VALUES (?, 'system', '自動對帳', ?, ?)`,
      )
        .bind(reg.id, `入帳 ${input.amount} 元（交易序號 ${input.ref}）`, now)
        .run();
      await notifyPaid(env, paid);
      return { result, registration: paid };
    }
    // 併發情況：另一筆通知已先完成付款，修正入帳紀錄的結果
    await env.DB.prepare(`UPDATE payment_events SET result = 'already_paid' WHERE ref = ?`).bind(input.ref).run();
    return { result: 'already_paid', registration: reg };
  }
  return { result, registration: reg ?? undefined };
}
