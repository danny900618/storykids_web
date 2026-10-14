// 產生 Bitwarden 匯入範本（credentials-template.csv）：只有項目名稱、網址、帳號與說明，不含任何密碼
// 用法：npm run credentials:template → Bitwarden 網頁版「匯入資料」選 Bitwarden (csv) → 匯入後逐項填入密碼 → 刪除檔案
// 項目內容與 docs/credentials.md 對應，修改時兩邊一起改
import { writeFileSync } from 'node:fs';

const items = [
  // [資料夾, 名稱, 網址, 帳號, 說明]
  ['故事講堂／服務帳號', 'A1 Google 補習班信箱', 'https://mail.google.com', 'story698@gmail.com', '其他服務的註冊與密碼重設信箱；開啟兩步驟驗證'],
  ['故事講堂／服務帳號', 'A2 GitHub（repo 擁有者）', 'https://github.com', 'danny900618', 'repo danny900618/storykids_web；開啟兩步驟驗證'],
  ['故事講堂／服務帳號', 'A4 Cloudflare', 'https://dash.cloudflare.com', 'c0981985611@gmail.com', 'Workers、D1、Turnstile、Zero Trust；開啟兩步驟驗證'],
  ['故事講堂／服務帳號', 'A5 AWS 根帳號（Lightsail）', 'https://lightsail.aws.amazon.com', '', '轉發主機 storykids-sms-relay；根帳號 MFA；固定 IP 52.194.121.120 不可釋放'],
  ['故事講堂／服務帳號', 'A6 Brevo', 'https://app.brevo.com', '', '寄送通知信'],
  ['故事講堂／服務帳號', 'A7 三竹簡訊（三站）', 'https://sms2.mitake.com.tw', '', '企業帳號；同時是 Worker 的 MITAKE_USERNAME／MITAKE_PASSWORD（兩個環境）'],
  ['故事講堂／服務帳號', 'A8 網路中文（網域）', 'https://www.net-chinese.com.tw', '', 'storykids.com.tw，到期 2028-04-17，開啟自動續約'],
  ['故事講堂／Worker 密鑰', 'B1 ADMIN_PASSWORD（測試環境後台）', 'https://storykids-web.c0981985611.workers.dev/admin', '', '報名管理後台暫時密碼；帳號欄位任意（填自己的名字）'],
  ['故事講堂／Worker 密鑰', 'B2 TURNSTILE_SECRET_KEY', 'https://dash.cloudflare.com', '', 'Turnstile 故事講堂報名的 Secret key；測試與正式同一組'],
  ['故事講堂／Worker 密鑰', 'B3 BREVO_API_KEY（測試環境）', 'https://app.brevo.com', '', 'Brevo API key（測試環境用）'],
  ['故事講堂／Worker 密鑰', 'B3 BREVO_API_KEY（正式環境）', 'https://app.brevo.com', '', 'Brevo API key（正式環境用，名稱 storykids-production）'],
  ['故事講堂／Worker 密鑰', 'B4 GITHUB_CLIENT_SECRET', 'https://github.com/settings/developers', 'Ov23liDuGhok8y2SHlCF', '內容後台 GitHub 登入（OAuth App）；帳號欄位為 Client ID'],
  ['故事講堂／Worker 密鑰', 'B7＋C1 簡訊轉發密鑰（SMS_RELAY_KEY／RELAY_KEY）', '', '', 'Worker 兩個環境的 SMS_RELAY_KEY＝主機 /etc/caddy/relay.env 的 RELAY_KEY；要換三處一起改'],
  ['故事講堂／Worker 密鑰', 'B8＋C3 銷帳檔轉交密鑰（TAISHIN_FILE_KEY）', '', '', '正式環境 TAISHIN_FILE_KEY＝主機 /etc/taishin-forward.headers；要換兩處一起改'],
  ['故事講堂／轉發主機', 'C2 sFTP 帳號 taishin（台新上傳）', 'sftp://52.194.121.120:2222', 'taishin', '台新申請書上的登入密碼；要換須向台新申請變更'],
];

const csv = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const header = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp';
const rows = items.map(([folder, name, uri, user, notes]) => [folder, '', 'login', name, notes, '', '0', uri, user, '', ''].map(csv).join(','));
writeFileSync('credentials-template.csv', `${[header, ...rows].join('\n')}\n`);
console.log(`已產生 credentials-template.csv（${rows.length} 項，不含密碼）`);
console.log('Bitwarden 網頁版 → 工具 → 匯入資料 → Bitwarden (csv)；匯入後逐項填入密碼，完成後刪除這個檔案');
