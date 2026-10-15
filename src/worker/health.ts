// 系統健康檢查：Cron Trigger 每小時執行（只設定在正式環境），有問題才寄信；同一個問題 24 小時內只寄一次
// 報名管理後台也會呼叫 checkHealth() 顯示目前的問題（不寄信）
// 對外是否連得上（網站、API、轉發主機）由 UptimeRobot 監測（README「監控」）
import type { Env } from './env';
import { nowIso } from './env';
import { sendEmailLive } from './notify';

// 門檻
export const EMAIL_DAILY_LIMIT = 300; // Brevo 免費方案每日上限
const EMAIL_WARN_AT = 250;
const SMS_POINTS_WARN_BELOW = 300;
const ALERT_INTERVAL_MS = 24 * 3600_000;

export interface HealthIssue {
  key: string;
  level: 'warning' | 'error';
  message: string;
}

// 台灣時間今天 00:00（UTC ISO）
function taiwanTodayStartIso(now = new Date()): string {
  const tw = new Date(now.getTime() + 8 * 3600_000);
  return new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate()) - 8 * 3600_000).toISOString();
}

// 轉發主機的健康檢查網址：由 MITAKE_API_URL 推得（直連三竹時不檢查）
function relayHealthUrl(env: Env): string | null {
  if (!env.MITAKE_API_URL || !env.SMS_RELAY_KEY) return null;
  const url = new URL(env.MITAKE_API_URL);
  if (url.hostname.endsWith('mitake.com.tw')) return null;
  return `${url.origin}/healthz`;
}

// 轉發主機檢查：連不上時間隔重試（主機自動安全更新可能剛好在重開機，約 1 分鐘）
async function relayReachable(url: string, attempts: number, delayMs: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    const ok = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      .then(async (res) => res.ok && (await res.text()).trim() === 'ok')
      .catch(() => false);
    if (ok) return true;
  }
  return false;
}

// opts.relayAttempts：排程用 3 次（間隔 30 秒）避免主機重開機時誤報；後台即時查看用 1 次
export async function checkHealth(env: Env, opts: { relayAttempts?: number; relayRetryDelayMs?: number } = {}): Promise<HealthIssue[]> {
  const issues: HealthIssue[] = [];
  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();

  const [emailsToday, failures, smsPoint, badFiles, reviews] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE channel = 'email' AND result = 'sent' AND created_at >= ?`)
      .bind(taiwanTodayStartIso())
      .first<{ n: number }>(),
    env.DB.prepare(`SELECT channel, COUNT(*) AS n FROM notifications WHERE result = 'failed' AND created_at >= ? GROUP BY channel`)
      .bind(since24h)
      .all<{ channel: string; n: number }>(),
    env.DB.prepare(`SELECT body FROM notifications WHERE channel = 'sms' AND result = 'sent' AND body LIKE '%［三竹剩餘點數%' ORDER BY id DESC LIMIT 1`).first<{ body: string }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM bank_files WHERE status = 'failed' AND received_at >= ?`).bind(since24h).first<{ n: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM registrations WHERE review_note IS NOT NULL`).first<{ n: number }>(),
  ]);

  const sent = emailsToday?.n ?? 0;
  if (sent >= EMAIL_WARN_AT) {
    issues.push({
      key: 'email_quota',
      level: sent >= EMAIL_DAILY_LIMIT ? 'error' : 'warning',
      message: `今天已寄出 ${sent} 封 Email，Brevo 免費方案每天上限 ${EMAIL_DAILY_LIMIT} 封${sent >= EMAIL_DAILY_LIMIT ? '，今天之後的通知信會寄送失敗' : ''}。報名高峰期可先升級 Brevo 方案`,
    });
  }

  const failed = failures.results.map((r) => `${r.channel === 'email' ? 'Email' : '簡訊'} ${r.n} 則`).join('、');
  if (failed) issues.push({ key: 'send_failures', level: 'error', message: `過去 24 小時有通知寄送失敗：${failed}（報名管理後台各筆「紀錄」可看原因）` });

  const points = Number(smsPoint?.body.match(/三竹剩餘點數 (\d+)/)?.[1]);
  if (Number.isFinite(points) && points < SMS_POINTS_WARN_BELOW) {
    issues.push({ key: 'sms_points', level: points < 50 ? 'error' : 'warning', message: `三竹簡訊剩餘 ${points} 點，請儘快儲值（點數用完簡訊會停止發送）` });
  }

  if ((badFiles?.n ?? 0) > 0) {
    issues.push({ key: 'bank_files', level: 'error', message: `過去 24 小時有 ${badFiles!.n} 個台新銷帳檔無法完整辨識，請在報名管理後台「台新銷帳檔」查看` });
  }

  if ((reviews?.n ?? 0) > 0) {
    issues.push({ key: 'review_needed', level: 'warning', message: `有 ${reviews!.n} 筆報名「需人工確認」（入帳金額不符、逾期入帳、重複繳費等），請在報名管理後台處理` });
  }

  const healthUrl = relayHealthUrl(env);
  if (healthUrl) {
    const ok = await relayReachable(healthUrl, opts.relayAttempts ?? 1, opts.relayRetryDelayMs ?? 30_000);
    if (!ok) issues.push({ key: 'relay', level: 'error', message: `簡訊／銷帳檔轉發主機（${new URL(healthUrl).hostname}）沒有回應：簡訊可能發不出去、台新入帳資料可能進不來` });
  }

  return issues;
}

// 排程：檢查並寄出警告（每個問題 24 小時內只寄一次）
export async function runHealthCheck(env: Env, opts: { relayRetryDelayMs?: number } = {}): Promise<{ issues: HealthIssue[]; alerted: string[] }> {
  const issues = await checkHealth(env, { relayAttempts: 3, relayRetryDelayMs: opts.relayRetryDelayMs });
  const now = nowIso();
  const cutoff = new Date(Date.now() - ALERT_INTERVAL_MS).toISOString();
  const { results: recent } = await env.DB.prepare('SELECT key FROM health_alerts WHERE last_alert_at > ?').bind(cutoff).all<{ key: string }>();
  const recentKeys = new Set(recent.map((r) => r.key));
  const fresh = issues.filter((i) => !recentKeys.has(i.key));
  const recipients = (env.HEALTH_ALERT_TO ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!fresh.length || !recipients.length || !env.BREVO_API_KEY) return { issues, alerted: [] };

  const label = env.ENV_LABEL ? `［${env.ENV_LABEL}］` : '';
  const body = [
    `故事講堂系統健康檢查發現以下問題（${new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')}）：`,
    '',
    ...fresh.map((i) => `${i.level === 'error' ? '🔴' : '🟡'} ${i.message}`),
    '',
    '同一個問題 24 小時內只會通知一次。報名管理後台上方也會顯示目前的問題。',
  ].join('\n');
  // 內部警告：不論 MAIL_MODE 都直接寄出；寄件人可用 HEALTH_ALERT_FROM 指定（寄件網域驗證完成前用已驗證的信箱）
  let sentOk = false;
  for (const to of recipients) {
    try {
      await sendEmailLive(env, { channel: 'email', recipient: to, subject: `${label}故事講堂系統警告：${fresh.length} 個問題`, body }, { from: env.HEALTH_ALERT_FROM });
      sentOk = true;
    } catch (err) {
      console.error('健康檢查警告寄送失敗', to, err);
    }
  }
  if (!sentOk) return { issues, alerted: [] };
  await env.DB.batch(
    fresh.map((i) =>
      env.DB.prepare(
        `INSERT INTO health_alerts (key, last_alert_at, detail) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET last_alert_at = excluded.last_alert_at, detail = excluded.detail`,
      ).bind(i.key, now, i.message),
    ),
  );
  return { issues, alerted: fresh.map((i) => i.key) };
}
