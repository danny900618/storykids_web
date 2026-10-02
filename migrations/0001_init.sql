-- 報名系統資料表（Cloudflare D1 / SQLite）
-- 套用：npx wrangler d1 migrations apply storykids --local（本機）或 --remote（正式）

-- 報名資料
CREATE TABLE registrations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 時段代號（對應內容後台課程裡的「上課時段 › 代號」）
  session_code    TEXT NOT NULL,
  -- 報名當下的課程與時段名稱快照（之後 CMS 改名也不影響舊報名）
  course_id       TEXT NOT NULL,
  course_title    TEXT NOT NULL,
  session_name    TEXT NOT NULL,
  -- 報名欄位（沿用舊系統）
  student_name    TEXT NOT NULL,
  parent_name     TEXT NOT NULL,
  school          TEXT,
  grade           TEXT,
  phone           TEXT NOT NULL,
  email           TEXT NOT NULL,
  note            TEXT,
  -- 正取 / 候補（名額內為正取，額滿為候補）
  admission       TEXT NOT NULL CHECK (admission IN ('正取', '候補')),
  -- 狀態（沿用舊系統）：待處理、等待付費、已付訂金、已付費、合庫轉帳、現金繳清、轉至其他梯次、取消報名
  status          TEXT NOT NULL,
  -- 應繳金額（報名當下的時段費用）
  amount          INTEGER NOT NULL,
  -- 台新虛擬帳號與繳費期限（候補不產生）
  va_account      TEXT UNIQUE,
  va_expires_at   TEXT,
  -- 實際入帳
  paid_amount     INTEGER,
  paid_at         TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_registrations_session ON registrations (session_code, admission, status);
CREATE INDEX idx_registrations_phone ON registrations (phone);

-- 通知紀錄（Email / 簡訊）。測試模式下只寫紀錄、不真的寄出
CREATE TABLE notifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER REFERENCES registrations (id),
  channel         TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  recipient       TEXT NOT NULL,
  subject         TEXT,
  body            TEXT NOT NULL,
  -- mock：測試模式未寄出；sent：已寄出；failed：寄送失敗
  result          TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_notifications_registration ON notifications (registration_id);

-- 入帳紀錄（台新入帳通知 / 模擬入帳）。ref 為銀行交易序號，UNIQUE 防止重複入帳
CREATE TABLE payment_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ref             TEXT NOT NULL UNIQUE,
  va_account      TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  registration_id INTEGER REFERENCES registrations (id),
  -- paid：對帳成功；amount_mismatch：金額不符；unmatched：查無帳號；already_paid：重複繳費
  result          TEXT NOT NULL,
  raw             TEXT,
  created_at      TEXT NOT NULL
);

-- 後台操作紀錄（誰在什麼時候改了什麼）
CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER REFERENCES registrations (id),
  actor           TEXT NOT NULL,
  action          TEXT NOT NULL,
  detail          TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_audit_registration ON audit_log (registration_id);
