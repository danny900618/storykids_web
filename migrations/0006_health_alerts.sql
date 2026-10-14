-- 系統健康檢查（health.ts）：每個問題最後一次寄出警告的時間，同一個問題 24 小時內只寄一次
CREATE TABLE health_alerts (
  key             TEXT PRIMARY KEY, -- 問題代號，例如 email_quota、sms_points、relay
  last_alert_at   TEXT NOT NULL,
  detail          TEXT
);
