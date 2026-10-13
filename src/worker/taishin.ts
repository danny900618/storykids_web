// 台新銀行虛擬帳號：帳號產生（公式 5：帳號＋日期＋金額檢核）與銷帳檔解析
// 依據台新「虛擬帳號代收帳號及銷帳格式說明－公式5」（2026-10-13 取得，原檔不放 repo）
//
// 帳號 14 碼 = 企業代碼 96989（5 碼）＋ 自編銷帳代碼（4 碼）＋ 繳款截止日（4 碼：民國年尾數 1 碼＋年中第幾天 3 碼）＋ 檢查碼（1 碼）
// 銀行端會依公式檢核帳號、截止日與金額：逾期或金額不符的轉帳多半會被銀行拒絕（台新表示金額仍可能不符而入帳，系統照樣檢查）
// 舊站 1,542 個帳號驗證：截止日格式全部合理；學期班 11,000 元的帳號檢查碼 100% 吻合

export const COMPANY_CODE = '96989';

// 檢查碼：第 1、3、5…13 位相加 ×3 ＋ 第 2、4…12 位相加 ＋ 金額加權，取個位數的 10 補數
// 金額加權：(佰萬位＋個位)×5 ＋ (拾萬位＋拾位)×4 ＋ (萬位＋佰位)×3 ＋ 千位×2
// （台新範例把第 1、3、5…位稱為「偶數碼」，此處依範例實際位置計算）
export function checkDigit(base13: string, amount: number): number {
  if (!/^\d{13}$/.test(base13)) throw new Error('帳號前 13 碼格式錯誤');
  if (!Number.isInteger(amount) || amount < 0 || amount > 9_999_999) throw new Error('金額需為 0～9,999,999 的整數');
  const d = [...base13].map(Number);
  const odd = d.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
  const even = d.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0);
  const [m, hk, tk, k, h, t, u] = String(amount).padStart(7, '0').split('').map(Number);
  const weighted = (m + u) * 5 + (hk + t) * 4 + (tk + h) * 3 + k * 2;
  return (10 - ((odd * 3 + even + weighted) % 10)) % 10;
}

// 繳款截止日 4 碼：民國年尾數＋年中第幾天（台灣時間），例如 2025-12-31 → 4365
export function dueDateCode(deadlineIso: string): string {
  const tw = new Date(new Date(deadlineIso).getTime() + 8 * 3600_000);
  const y = tw.getUTCFullYear();
  const dayOfYear = Math.floor((Date.UTC(y, tw.getUTCMonth(), tw.getUTCDate()) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
  return `${(y - 1911) % 10}${String(dayOfYear).padStart(3, '0')}`;
}

// 產生虛擬帳號。customerCode：自編銷帳代碼（取報名編號後 4 碼；同一截止日內不會重複）
export function buildVirtualAccount(customerCode: number, deadlineIso: string, amount: number): string {
  const base = `${COMPANY_CODE}${String(customerCode % 10_000).padStart(4, '0')}${dueDateCode(deadlineIso)}`;
  return `${base}${checkDigit(base, amount)}`;
}

// 帳號格式與檢查碼是否正確（對帳時參考用）
export function isValidVirtualAccount(va: string, amount: number): boolean {
  return /^\d{14}$/.test(va) && va.startsWith(COMPANY_CODE) && checkDigit(va.slice(0, 13), amount) === Number(va[13]);
}

// ---- 銷帳檔（一般下載格式，TXT；固定欄位或 TAB 分隔） ----
// 欄位：序號 C10、日期 C10（YYYY/MM/DD）、存入金額 N15、繳款虛擬帳號 C20、交易代號 C4、正/負 C16、備註 C40（轉出行庫代碼 3 碼）
const FIELD_WIDTHS = [10, 10, 15, 20, 4, 16, 40];

export interface SettlementRecord {
  serial: string; // 序號
  date: string; // YYYY/MM/DD
  amount: number;
  va: string; // 繳款虛擬帳號
  txCode: string; // REM 跨行匯款、OTC 台新臨櫃、ATM、IBB 網路銀行
  sign: '+' | '-'; // + 轉入；- 支取（沖正）
  bankCode: string; // 轉出行庫代碼
  ref: string; // 對帳用唯一識別：同一筆交易重送時相同
  line: string;
}

export function parseSettlementFile(bytes: Uint8Array): { records: SettlementRecord[]; errors: string[] } {
  // 欄位都是英數字，以單一位元組解碼確保固定欄位位置正確（即使備註含 Big5 也不會錯位）
  const text = new TextDecoder('latin1').decode(bytes);
  const records: SettlementRecord[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) return;
    let fields: string[];
    if (line.includes('\t')) {
      fields = line.split('\t');
    } else {
      let pos = 0;
      fields = FIELD_WIDTHS.map((w) => {
        const f = line.slice(pos, pos + w);
        pos += w;
        return f;
      });
    }
    const [serial, date, amountRaw, va, txCode, signRaw, remark = ''] = fields.map((f) => (f ?? '').trim());
    const amount = Number(amountRaw);
    const sign = signRaw.startsWith('-') ? '-' : signRaw.startsWith('+') ? '+' : null;
    if (!/^\d+$/.test(serial) || !/^\d{4}\/\d{2}\/\d{2}$/.test(date) || !/^\d+$/.test(amountRaw) || !/^\d{14}$/.test(va) || !sign) {
      errors.push(`第 ${index + 1} 行格式無法辨識`);
      return;
    }
    records.push({
      serial,
      date,
      amount,
      va,
      txCode,
      sign,
      bankCode: remark.slice(0, 3),
      ref: `TS-${date.replace(/\//g, '')}-${serial}-${va}-${amount}-${sign === '+' ? 'C' : 'D'}`,
      line,
    });
  });
  return { records, errors };
}
