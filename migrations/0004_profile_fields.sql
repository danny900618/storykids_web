-- 報名欄位補齊（沿用舊站報名表）、優待金額、同意的報名辦法、舊站資料匯入

-- 舊站報名表欄位
ALTER TABLE registrations ADD COLUMN gender TEXT;          -- 性別：男／女
ALTER TABLE registrations ADD COLUMN tel TEXT;             -- 聯絡電話（市話，選填）；phone 為行動電話
ALTER TABLE registrations ADD COLUMN zip TEXT;             -- 郵遞區號
ALTER TABLE registrations ADD COLUMN address TEXT;         -- 地址
ALTER TABLE registrations ADD COLUMN diet TEXT;            -- 飲食習慣：葷／方便素（僅寒暑假班）

-- 優待金額：後台人員自由填寫，只做顯示，不影響應繳金額（amount）與已產生的繳費帳號
ALTER TABLE registrations ADD COLUMN discount_amount INTEGER;

-- 報名時家長勾選同意的補課／退費辦法名稱（快照，之後後台改內容也不影響）
ALTER TABLE registrations ADD COLUMN agreed_policies TEXT;

-- 舊站匯入的報名（scripts/import-legacy.mjs）：舊站編號、梯次（例如「11509學期」）、舊站虛擬帳號
-- 舊站帳號另存一欄、不放 va_account，避免與新系統帳號衝突或被自動對帳誤認
ALTER TABLE registrations ADD COLUMN legacy_id INTEGER;
ALTER TABLE registrations ADD COLUMN legacy_term TEXT;
ALTER TABLE registrations ADD COLUMN legacy_va TEXT;
-- 重複匯入同一份檔案不會產生重複資料
CREATE UNIQUE INDEX idx_registrations_legacy ON registrations (legacy_term, legacy_id) WHERE legacy_id IS NOT NULL;
