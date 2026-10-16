-- 報名軟刪除：誤報名時從列表隱藏、釋放名額，但保留紀錄（繳費帳號仍有效，之後若有入帳才對得到、轉人工確認），可復原
ALTER TABLE registrations ADD COLUMN deleted_at TEXT;
ALTER TABLE registrations ADD COLUMN deleted_by TEXT;
ALTER TABLE registrations ADD COLUMN delete_reason TEXT;
