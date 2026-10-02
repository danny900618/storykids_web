# 故事講堂官網（storykids.com.tw）

台中市私立故事講堂國語藝術短期補習班的官方網站與線上報名系統。

- 詳細規格、決策紀錄、待確認事項與任務進度：[project.yaml](project.yaml)
- 給 AI 協作的開發規則：[CLAUDE.md](CLAUDE.md)

## 系統架構

```
                     ┌──────────── Cloudflare Workers（專案名稱 storykids-web）────────────┐
訪客 ─── 瀏覽網頁 ──▶ │ 靜態網頁 dist/（Astro 建置）           ← 不經過後端，流量免費不限量   │
                     │                                                                    │
家長 ─── 線上報名 ──▶ │ /api/*  後端（src/worker/）──▶ D1 資料庫 storykids（報名資料、個資） │
                     │                         ├──▶ 台新虛擬帳號（目前為測試假資料）        │
                     │                         ├──▶ 三竹簡訊（目前為測試模式，不寄出）      │
                     │                         └──▶ Email 通知（目前為測試模式，不寄出）    │
行政 ─── 報名管理 ──▶ │ /admin  報名管理後台（需登入）                                     │
                     └────────────────────────────────────────────────────────────────────┘
                                  ▲ push 自動部署
編輯 ─── 內容管理 ──▶ /cms（Sveltia CMS，GitHub 登入）──▶ GitHub repo（消息、課程、上課時段、老師、相簿、網站設定）
```

## 使用的服務

| 服務 | 用途 | 費用 | 帳號 |
|---|---|---|---|
| [GitHub](https://github.com/danny900618/storykids_web) | 程式碼與網站內容（Markdown／JSON／圖片） | 免費 | 目前在開發者個人帳號，交付時轉給補習班 |
| [Cloudflare Workers](https://dash.cloudflare.com) | 網站主機、後端 API、自動部署（push 到 `main` 即部署） | 免費（靜態流量不限量；API 每天 10 萬次） | 補習班帳號 |
| Cloudflare D1 | 報名資料庫（資料庫名稱 `storykids`） | 免費額度內 | 同上 |
| Cloudflare Access（建議） | 報名管理後台登入（Email 驗證碼） | 免費（50 人以內） | 同上 |
| [Sveltia CMS](https://sveltiacms.app) | 內容後台 `/cms`：消息、課程與上課時段、老師、相簿、網站設定（開源，網頁放在本站，登入流程由本站 Worker 處理，不依賴第三方伺服器） | 免費 | 每位編輯者需有 GitHub 帳號，並加為 repo 協作者（Write 權限） |
| GitHub OAuth App | 內容後台的「用 GitHub 登入」 | 免費 | 建在 repo 擁有者帳號下；callback URL：`https://網站網址/api/cms-auth/callback` |
| 遠振資訊 | 網域 storykids.com.tw 註冊 | 每年續約 | 補習班 |
| 三竹簡訊 | 報名、繳費簡訊 | 每則計費 | **尚未串接** |
| 台新銀行 | 虛擬帳號代收、自動對帳 | 代收手續費 | **尚未串接** |
| 寄信服務（建議 Brevo） | 報名確認信，寄件人 `故事講堂 <service@storykids.com.tw>` | 免費每天 300 封 | **尚未串接** |

- 預覽網址：https://storykids-web.c0981985611.workers.dev
- 正式網址：https://storykids.com.tw（DNS 尚未切換）

## 兩個後台

| | 內容管理（/cms） | 報名管理（/admin） |
|---|---|---|
| 網址 | https://網站網址/cms | https://網站網址/admin |
| 登入 | GitHub 帳號 | Cloudflare Access（Email 驗證碼）或暫時密碼 |
| 管什麼 | 網站內容，**包含課程的「上課時段」（名額、費用、代號）** | 報名資料：正取／候補、狀態、繳費、匯出 Excel、通知紀錄 |
| 資料在哪 | GitHub | Cloudflare D1 |
| 設定檔 | [public/cms/config.yml](public/cms/config.yml)、登入 [src/worker/cms-auth.ts](src/worker/cms-auth.ts) | [src/worker/](src/worker/)、[src/pages/admin/](src/pages/admin/) |

兩邊以「**時段代號**」串接：建置時把所有上課時段輸出成 `/data/sessions.json`，後端依此判斷名額與應繳金額。**已有人報名的時段，不要在 CMS 刪除或修改代號**（後台會顯示警告）。

## 報名流程

1. 家長在課程頁選時段 → `/register?session=代號` 填表
2. 後端以單一 SQL 判斷名額並寫入（多人同時報名不會超收）
   - 名額內 → **正取**，狀態「等待付費」，產生虛擬帳號，繳費期限為報名日起第 3 天 23:59
   - 額滿 → **候補**，狀態「待處理」，**不產生帳號**
3. 寄出通知：家長 Email＋簡訊、公司信箱（`COMPANY_EMAIL`）
4. 入帳 → 對帳（`src/worker/payment.ts` 的 `reconcile()`）→「已付費」→ 寄收據
5. 逾期未繳自動釋出名額（不需排程，計算名額時排除）；行政可在後台把候補遞補為正取（自動產生帳號並通知）

### 測試模式（目前）

`wrangler.jsonc` 的 `MAIL_MODE`／`SMS_MODE`／`PAYMENT_MODE` 都是 `mock`：

- 虛擬帳號是假資料（`96989` + 報名編號 + 假檢查碼）
- Email、簡訊不會寄出，內容寫進 `notifications` 資料表，在後台「紀錄」可以看到
- 後台每筆有「模擬入帳」按鈕，走跟台新入帳通知相同的對帳流程

### 尚未串接（拿到資料後要做的事）

| 項目 | 要改的地方 |
|---|---|
| 台新虛擬帳號規則 | `src/worker/payment.ts` → `generateVirtualAccount()` |
| 台新入帳通知 | `src/worker/index.ts` 的 `/api/taishin/notify`：驗證來源與簽章、解密後呼叫 `reconcile()` |
| 三竹簡訊 | `src/worker/notify.ts` → `sendSmsLive()`，帳密用 `wrangler secret put` 設定 |
| Email | `src/worker/notify.ts` → `sendEmailLive()`；DNS 需設定寄信服務的 SPF／DKIM |
| 正式啟用 | 三個 `*_MODE` 改為 `live` |

## 專案結構

```
├── project.yaml              # 規格與任務（先讀這份）
├── wrangler.jsonc            # Cloudflare 部署設定（Worker、D1、環境變數）
├── migrations/               # D1 資料表結構
├── public/                   # 圖片（images/）、PDF（files/）、_redirects（舊網址轉址）、cms/（內容後台與欄位設定 config.yml）
├── src/
│   ├── content/              # 網站內容（由內容後台 /cms 編輯）
│   ├── content.config.ts     # 內容欄位定義（與 public/cms/config.yml 對應）
│   ├── pages/                # 網頁；register.astro 報名頁；admin/ 報名管理；data/sessions.json.ts 時段資料
│   ├── components/  layouts/  lib/  styles/
│   └── worker/               # 後端：index（路由）、register、admin、auth、payment、notify、sessions、cms-auth（內容後台登入）
└── .github/workflows/        # 後台上傳圖片自動縮圖
```

## 開發

```sh
npm install

npm run dev                 # 只看網頁（不含報名後端）http://localhost:4321

# 含報名後端與本機資料庫
npm run db:migrate:local    # 第一次：建立本機資料表
npm run dev:full            # 建置後啟動 http://localhost:8787（後台 /admin）

npm run check               # 網頁型別檢查
npm run check:worker        # 後端型別檢查
```

本機後台登入：在 `.dev.vars`（不進版控）設定 `ADMIN_DEV_BYPASS=true`。

## 部署

push 到 `main` 後，Cloudflare 會自動建置（`npm run build`）並部署（`npx wrangler deploy`）。

### 第一次啟用報名系統（只需做一次）

```sh
npx wrangler login                      # 登入補習班的 Cloudflare 帳號
npx wrangler d1 create storykids        # 建立資料庫 → 把 database_id 填進 wrangler.jsonc
npm run db:migrate:remote               # 在正式資料庫建立資料表
npx wrangler secret put ADMIN_PASSWORD  # 暫時的後台密碼（正式建議改用 Cloudflare Access）
```

### 內容後台（/cms）登入設定（只需做一次）

1. GitHub → Settings → Developer settings → **OAuth Apps → New OAuth App**
   - Homepage URL：`https://網站網址`
   - Authorization callback URL：`https://網站網址/api/cms-auth/callback`
2. 把 Client ID 填進 `wrangler.jsonc` 的 `GITHUB_CLIENT_ID`，Client secret 用 `npx wrangler secret put GITHUB_CLIENT_SECRET` 設定
3. 編輯者：申請 GitHub 帳號 → repo **Settings → Collaborators** 邀請（Write 權限）→ 對方接受邀請後即可在 `/cms` 用 GitHub 登入
4. 換網域時：更新 `public/cms/config.yml` 的 `base_url`／`site_url` 與 OAuth App 的網址

### 報名管理後台登入方式

依優先順序（`src/worker/auth.ts`），**都沒設定時後台一律拒絕存取**：

1. **Cloudflare Access（建議）**：Cloudflare Zero Trust 為 `/admin*`、`/api/admin/*` 建立 Access 應用程式，允許行政人員的 Email；再設定環境變數 `ACCESS_TEAM_DOMAIN`（例如 `storykids.cloudflareaccess.com`）與 `ACCESS_AUD`
2. **暫時密碼**：`ADMIN_PASSWORD`（secret），瀏覽器會跳出帳號密碼視窗，帳號任意
3. **本機開發**：`.dev.vars` 的 `ADMIN_DEV_BYPASS=true`

### 資料庫異動

新增 `migrations/000X_xxx.sql` → 本機 `npm run db:migrate:local` 測試 → 正式 `npm run db:migrate:remote`。

## 注意事項

- **個資只存在 D1**，絕不寫進 GitHub；匯出的 Excel 請妥善保管
- 內容後台存檔會直接 commit 到 GitHub，本機修改前先 `git pull`
- 內容後台的欄位預設為必填，選填欄位要在 `public/cms/config.yml` 加 `required: false`；清空的欄位可能寫入 `null` 或空字串，`content.config.ts` 的選填欄位必須接受 nullish
- 舊網站網址轉址在 `public/_redirects`（不支援比對查詢參數）
