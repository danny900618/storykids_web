# 帳號與密鑰清單

這份清單只記錄**有哪些**帳號與密鑰、**存在哪裡**、**怎麼重新產生**，**不記錄任何密碼或密鑰的內容**。
實際的值請存在密碼管理工具（建議 Bitwarden，見文末），**絕對不要寫進這個檔案或 repo 的任何地方**。

> Cloudflare 的 secret、Brevo API key、GitHub client secret 設定後**都看不到原本的值**。
> 遺失時只能重新產生，再更新所有用到的地方（下表「同一組要一起改」）。

---

## 一、服務帳號（登入用）

| # | 服務 | 用途 | 登入網址 | 擁有者／帳號 | 備註 |
|---|---|---|---|---|---|
| A1 | Google（補習班信箱） | 其他服務的註冊信箱、密碼重設、通知 | https://mail.google.com | story698@gmail.com | **最重要**：多數服務的密碼重設都寄到這裡；開啟兩步驟驗證 |
| A2 | GitHub（repo 擁有者） | 程式與網站內容、內容後台登入 | https://github.com | danny900618（開發者） | repo：danny900618/storykids_web；開啟兩步驟驗證 |
| A3 | GitHub（補習班人員） | 內容後台 `/cms` 登入 | https://github.com | 每位人員自己的帳號（例如 storykids-jerry） | 由人員自己保管；離職時從 repo 協作者移除 |
| A4 | Cloudflare | Workers（網站與後端）、D1 資料庫、Turnstile、Zero Trust | https://dash.cloudflare.com | c0981985611@gmail.com | 開啟兩步驟驗證 |
| A5 | AWS（Lightsail） | 轉發主機 storykids-sms-relay（簡訊、台新銷帳檔） | https://lightsail.aws.amazon.com | 根帳號 Email | **根帳號 MFA**；帳單綁信用卡 |
| A6 | Brevo | 寄送通知信 | https://app.brevo.com | 註冊 Email | — |
| A7 | 三竹簡訊（三站） | 簡訊發送、查點數與發送紀錄 | https://sms2.mitake.com.tw | 企業帳號 | 帳密同時是 Worker 的 MITAKE_USERNAME／MITAKE_PASSWORD（B5、B6） |
| A8 | 網路中文 | 網域 storykids.com.tw（到期 2028-04-17） | https://www.net-chinese.com.tw | 補習班會員帳號 | 開啟自動續約；註冊人待過戶（project.yaml Q2） |
| A9 | 台新銀行 | 虛擬帳號代收、企業網銀 | 依台新提供 | 補習班 | 由補習班保管 |

## 二、Cloudflare Worker 密鑰（secret）

設定：`npx wrangler secret put 名稱`（測試環境）／`npx wrangler secret put 名稱 --env production`（正式環境）
確認（只顯示名稱）：`npx wrangler secret list`／`npx wrangler secret list --env production`

| # | 名稱 | 用途 | 測試 | 正式 | 怎麼產生／從哪裡拿 | 同一組要一起改 |
|---|---|---|---|---|---|---|
| B1 | `ADMIN_PASSWORD` | 報名管理後台暫時密碼（上線後改 Email 驗證碼登入） | ✅ | 不設定 | 自訂（`openssl rand -base64 18`） | — |
| B2 | `TURNSTILE_SECRET_KEY` | 報名防機器人驗證（伺服器端） | ✅ | ✅ | Cloudflare → Turnstile → 故事講堂報名 → Settings（兩環境同一組） | 兩個環境 |
| B3 | `BREVO_API_KEY` | 寄送通知信 | ✅ | ✅ | Brevo → SMTP & API → API Keys（兩環境**各自一組**） | — |
| B4 | `GITHUB_CLIENT_SECRET` | 內容後台的 GitHub 登入 | ✅ | 上線時設定 | GitHub → Settings → Developer settings → OAuth Apps → Generate a new client secret | — |
| B5 | `MITAKE_USERNAME` | 三竹簡訊帳號 | ✅ | ✅ | 三竹（A7） | 兩個環境 |
| B6 | `MITAKE_PASSWORD` | 三竹簡訊密碼 | ✅ | ✅ | 三竹（A7）；三竹改密碼時兩環境都要更新 | 兩個環境 |
| B7 | `SMS_RELAY_KEY` | Worker 呼叫簡訊轉發主機的密鑰 | ✅ | ✅ | `openssl rand -hex 32` | **C1**、兩個環境 |
| B8 | `TAISHIN_FILE_KEY` | 轉發主機轉交台新銷帳檔給 Worker 的密鑰 | — | ✅ | `openssl rand -hex 32` | **C3** |

## 三、轉發主機（AWS Lightsail storykids-sms-relay）

| # | 名稱 | 用途 | 存在主機的哪裡 | 怎麼產生 | 同一組要一起改 |
|---|---|---|---|---|---|
| C1 | 轉發密鑰 `RELAY_KEY` | 簡訊轉發驗證 | `/etc/caddy/relay.env`（填寫用的 `relay/setup.local.sh` 已 gitignore） | 同 B7 | **B7**（兩個環境） |
| C2 | sFTP 帳號 `taishin` 的密碼 | 台新上傳銷帳檔登入 | 主機帳號密碼（`sudo bash sftp-setup.sh` 時設定） | 見 relay/README.md（20 字、去掉易混淆字元） | **台新申請書**（要換須向台新申請變更） |
| C3 | 銷帳檔轉交密鑰 | 轉交台新銷帳檔 | `/etc/taishin-forward.headers` | 同 B8 | **B8** |

主機管理：Lightsail 網頁的「使用 SSH 連線」，不需要另外保管 SSH 金鑰。
固定 IP：52.194.121.120（三竹白名單；台新 sFTP 主機）— 不是密碼，但**不可釋放**（見 relay/README.md）。

## 四、不是密碼的公開設定（寫在 wrangler.jsonc，不用保密）

Turnstile site key、GitHub OAuth Client ID、D1 資料庫 ID、Worker 網址、轉發主機 IP。

## 五、本機開發

`.dev.vars`（已 gitignore）：本機開發用的設定（ADMIN_DEV_BYPASS、Turnstile 測試金鑰），只在開發者電腦上，**不要分享**。

---

## 建議做法：Bitwarden

- 免費，手機、電腦、瀏覽器都能用；免費的「組織（Organization）」可以 2 個人共用一個保險庫：**補習班負責人＋開發者**
- 建議由**補習班的帳號建立組織**，開發者加入。交接時把開發者移出即可，資料留在補習班

### 匯入範本

`npm run credentials:template` 會產生 `credentials-template.csv`（已 gitignore，**不含任何密碼**，只有項目名稱、網址與說明）：

1. Bitwarden 網頁版 → 工具 → **匯入資料** → 格式選 **Bitwarden (csv)** → 選擇 `credentials-template.csv`
2. 匯入後逐項點開，把密碼／密鑰填進「密碼」欄位
3. **匯入完刪除** `credentials-template.csv`

### 什麼時候要更新

| 情況 | 要改的項目 |
|---|---|
| 人員離職 | A3 從 GitHub 協作者移除；B1 換新（若仍在用共用密碼） |
| 開發者交接 | A2、A4、A5、A6 改為補習班帳號或轉移擁有權（project.yaml D7）；換掉 B1、B7＋C1、B8＋C3 |
| 懷疑外流 | 依「同一組要一起改」欄位，兩邊同時更新 |
| 重建轉發主機 | 用同樣的 C1、C2、C3（從密碼管理工具取出），見 relay/README.md |
