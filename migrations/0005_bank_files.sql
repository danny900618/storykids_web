-- 台新銷帳檔（台新以 sFTP 上傳到轉發主機，主機轉交 Worker 保存）
-- 原始檔案完整保存（base64，保留原始位元組，例如 Big5 編碼），解析與對帳結果另記
CREATE TABLE bank_files (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  filename        TEXT NOT NULL,
  -- 檔案內容的 SHA-256：同一份檔案重送（台新補檔或轉交重試）只保存一次
  sha256          TEXT NOT NULL UNIQUE,
  size            INTEGER NOT NULL,
  content_b64     TEXT NOT NULL,
  received_at     TEXT NOT NULL,
  -- pending：尚未解析（例如格式規格未到）；parsed：已解析並對帳；failed：解析失敗（見 note）
  status          TEXT NOT NULL DEFAULT 'pending',
  -- 解析結果摘要，例如「共 12 筆：對帳成功 10、需人工確認 2」
  note            TEXT,
  processed_at    TEXT
);
CREATE INDEX idx_bank_files_received ON bank_files (received_at);
