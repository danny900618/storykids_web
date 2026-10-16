-- 早鳥折扣：報名時若在早鳥期間，記錄折扣金額（amount 已是折扣後的應繳金額，繳費帳號依此產生）
ALTER TABLE registrations ADD COLUMN early_bird_discount INTEGER;
