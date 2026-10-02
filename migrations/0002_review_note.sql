-- 需要人工確認的原因（例如：逾期後才入帳、入帳金額不符）。NULL = 不需要處理
-- 行政在後台修改這筆報名的狀態或正取／候補後會自動清除
ALTER TABLE registrations ADD COLUMN review_note TEXT;
