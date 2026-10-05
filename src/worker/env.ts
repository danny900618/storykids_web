// Cloudflare Rate Limiting binding（wrangler.jsonc 的 ratelimits）
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

// Worker 環境設定（wrangler.jsonc 的 vars 與 secrets）
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;

  // 次數限制：報名（每個 IP）、後台登入失敗（每個 IP）
  REGISTER_LIMITER?: RateLimiter;
  LOGIN_LIMITER?: RateLimiter;

  // Cloudflare Turnstile（防機器人）：site key 公開給前端；secret 用 `wrangler secret put TURNSTILE_SECRET_KEY`
  // 沒設定 secret 時略過驗證（仍有次數限制）
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;

  // 正式網域（逗號分隔）。正式網域上若金流仍為測試模式，會拒絕報名，避免家長拿到假的繳費帳號
  PRODUCTION_HOSTS?: string;

  // 'mock'：測試模式，只寫通知紀錄、不真的寄出；'live'：正式寄送（尚未串接）
  MAIL_MODE: string;
  SMS_MODE: string;
  // 'mock'：產生假虛擬帳號、後台可「模擬入帳」；'live'：台新正式串接（尚未串接）
  PAYMENT_MODE: string;

  MAIL_FROM: string; // 寄件人，例如「故事講堂 <service@storykids.com.tw>」
  MAIL_REPLY_TO?: string; // 家長回信的地址（選填，未設定則回到寄件人）
  PUBLIC_SITE_URL?: string; // 通知信裡的 Logo 與網站連結（上線後改為 https://storykids.com.tw）
  CONTACT_PHONE?: string; // 通知信防詐騙提醒裡的聯絡電話
  COMPANY_EMAIL: string; // 有人報名時通知的公司信箱
  BREVO_API_KEY?: string; // Brevo 寄信 API 金鑰：`wrangler secret put BREVO_API_KEY`

  // 三竹簡訊 HTTP API：帳號密碼用 `wrangler secret put MITAKE_USERNAME`／`MITAKE_PASSWORD`
  MITAKE_USERNAME?: string;
  MITAKE_PASSWORD?: string;
  // 發送網址：企業帳號 https://smsapi.mitake.com.tw/api/mtk/SmSend；個人帳號 http://smsb2c.mitake.com.tw/b2c/mtk/SmSend（以三竹提供的文件為準）
  MITAKE_API_URL?: string;

  // 後台登入（擇一）：
  // 1. Cloudflare Access（正式建議）：設定 ACCESS_TEAM_DOMAIN 與 ACCESS_AUD
  // 2. 暫時密碼（測試用）：用 `wrangler secret put ADMIN_PASSWORD` 設定
  // 3. 本機開發：.dev.vars 設 ADMIN_DEV_BYPASS=true
  // 都沒設定時後台一律拒絕存取
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_DEV_BYPASS?: string;

  // 內容後台（Sveltia CMS）的 GitHub 登入（src/worker/cms-auth.ts）
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string; // 用 `wrangler secret put GITHUB_CLIENT_SECRET` 設定
  CMS_ALLOWED_ORIGINS?: string; // 允許使用登入的 CMS 網址（逗號分隔），本身網址一律允許
}

// 上課時段（來自建置時產生的 /data/sessions.json）
export interface Session {
  code: string;
  name: string;
  time: string;
  capacity: number;
  price: number;
  open: boolean;
  course_id: string;
  course_title: string;
  // 課程層級資訊（通知信使用）
  category?: string; // 課程類別，例如「學期班（11509學期）」「115夏令營」
  schedule?: string; // 上課週期，例如「五天主題課程30小時」
  fee_note?: string; // 費用說明（退費規定等）
  location?: string; // 上課地點
}

export interface Registration {
  id: number;
  session_code: string;
  course_id: string;
  course_title: string;
  session_name: string;
  student_name: string;
  parent_name: string;
  school: string | null;
  grade: string | null;
  phone: string;
  email: string;
  note: string | null;
  admission: '正取' | '候補';
  status: string;
  amount: number;
  va_account: string | null;
  va_expires_at: string | null;
  paid_amount: number | null;
  paid_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

// 用戶端 IP（Cloudflare 提供），用於次數限制
export const clientIp = (request: Request) => request.headers.get('CF-Connecting-IP') ?? 'unknown';

// 是否為本機開發網址
export const isLocalRequest = (request: Request) => ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname);

// 狀態（沿用舊系統）
export const STATUSES = ['待處理', '等待付費', '已付訂金', '已付費', '合庫轉帳', '現金繳清', '轉至其他梯次', '取消報名'] as const;
// 不佔名額的狀態
export const RELEASED_STATUSES = ['取消報名', '轉至其他梯次'];

export const nowIso = () => new Date().toISOString();

// SQL 條件：這筆報名是否佔用名額（nowParam 為「現在時間」的參數位置，例如 '?1'）
// 正取，且不是取消／轉梯次，也不是「等待付費但已過繳費期限」（逾期自動釋出名額）
export const holdsSeatSql = (nowParam: string) => `(admission = '正取'
  AND status NOT IN ('取消報名', '轉至其他梯次')
  AND NOT (status = '等待付費' AND COALESCE(va_expires_at, '9999') < ${nowParam}))`;

// 這筆報名是否已逾期未繳（後台顯示用）
export const isExpired = (r: { status: string; va_expires_at: string | null }) =>
  r.status === '等待付費' && !!r.va_expires_at && r.va_expires_at < nowIso();

// 繳費期限：報名日（台灣時間）起算第 3 天 23:59:59
export function paymentDeadline(from = new Date()): string {
  const tw = new Date(from.getTime() + 8 * 3600_000);
  const deadlineUtc = Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate() + 3, 23, 59, 59) - 8 * 3600_000;
  return new Date(deadlineUtc).toISOString();
}

// 顯示用：轉成台灣時間「2026/11/08 23:59」
export function formatTw(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}
