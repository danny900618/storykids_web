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
| [GitHub](https://github.com/danny900618/storykids_web) | 程式碼與網站內容（Markdown／JSON／圖片） | 免費 | 開發者帳號 danny900618 |
| [Cloudflare Workers](https://dash.cloudflare.com) | 網站主機、後端 API、自動部署（push 到 `main` 即部署） | 免費（靜態流量不限量；API 每天 10 萬次） | 開發者帳號 c0981985611@gmail.com |
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

## 費用、額度與綁卡（2026-10 查證）

目前全部使用免費方案，**沒有任何服務需要綁信用卡，也沒有自動扣款**（網域續約除外）。

| 服務 | 方案 | 需要綁卡 | 免費額度 | 超過額度會怎樣 |
|---|---|---|---|---|
| Cloudflare Workers（網頁） | Free | 否 | 靜態網頁**免費、不限量** | 不會超過 |
| Cloudflare Workers（/api、/admin） | Free | 否 | 每天 10 萬次請求、每次 10ms CPU | **當天後續請求失敗**（報名、查名額、後台），台灣時間 08:00 重置；不收費 |
| Cloudflare D1 | Free | 否 | 每天讀 500 萬列、寫 10 萬列、容量 5 GB | 當天查詢失敗；不收費 |
| Workers Builds（自動部署） | Free | 否 | 每月 3,000 分鐘 | 當月無法部署（網站照常運作） |
| Cloudflare Access（正式上線後） | Zero Trust Free（50 人內） | **可能要求綁卡才能啟用**（不收費） | 50 位使用者 | — |
| GitHub | Free | 否 | 私有 repo；Actions 每月 2,000 分鐘 | Actions 停止（自動縮圖暫停）；預設預算 0，不會扣款 |
| Sveltia CMS | 開源 | 否 | — | 從 unpkg CDN 載入（已鎖定版本），CDN 故障時後台暫時打不開 |
| 網域（遠振） | 年費 | 視遠振設定 | — | **忘記續約網站會打不開**，建議開自動續約 |

**之後串接時會新增的費用**（依合約為準）：三竹簡訊（每則計費，通常為**預付點數，點數用完簡訊就停**，要留意餘額）、台新代收手續費（每筆）、寄信服務（Brevo 免費每天 300 封，超過當天停止寄送或升級付費）。

**選配：Cloudflare Workers Paid（每月 US$5）**：額度提高到每月 1,000 萬次請求，超過才按量計費。**需要綁信用卡、每月自動扣款**，Cloudflare 沒有消費上限設定。正式開放報名、擔心尖峰時段時再考慮升級。

來源：[Workers 價格](https://developers.cloudflare.com/workers/platform/pricing/)、[D1 價格](https://developers.cloudflare.com/d1/platform/pricing/)、[Workers Builds 限制](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)、[靜態資源計費](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)

## 兩個後台

| | 內容管理（/cms） | 報名管理（/admin） |
|---|---|---|
| 網址 | https://網站網址/cms | https://網站網址/admin |
| 登入 | GitHub 帳號 | Cloudflare Access（Email 驗證碼）或暫時密碼 |
| 管什麼 | 網站內容，**包含課程的「上課時段」（名額、費用、代號）** | 報名資料：正取／候補、狀態、繳費、匯出 Excel、通知紀錄 |
| 資料在哪 | GitHub | Cloudflare D1 |
| 設定檔 | [public/cms/config.yml](public/cms/config.yml)、登入 [src/worker/cms-auth.ts](src/worker/cms-auth.ts) | [src/worker/](src/worker/)、[src/pages/admin/](src/pages/admin/) |

兩邊以「**時段代號**」串接：建置時把所有上課時段輸出成 `/data/sessions.json`，後端依此判斷名額與應繳金額。時段代號由內容後台**自動產生、不可修改**（Sveltia `uuid` 欄位）；萬一缺少代號，該時段只顯示、不開放報名。**已有人報名的時段不要刪除**（要停止報名請取消「開放報名」；若被刪除，報名管理後台會顯示警告，原報名資料仍保留）。

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
| 三竹簡訊 | **已串接**（`sendSmsLive()`，HTTP API SmSend）。帳密用 `wrangler secret put MITAKE_USERNAME`／`MITAKE_PASSWORD`；發送網址 `MITAKE_API_URL`（企業／個人帳號不同）。測試通過後把 `SMS_MODE` 改為 `live`；後台「發測試簡訊」可測試（會扣點數），右上角顯示剩餘點數 |
| Email | **已串接 Brevo**（`sendEmailLive()`，金鑰 `BREVO_API_KEY` 已設定）。待 DNS 轉到 Cloudflare 後在 Brevo 驗證網域（DKIM／SPF／DMARC），再把 `MAIL_MODE` 改為 `live`；後台右上角「寄測試信」可隨時測試 |
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
npm test                    # 後端自動化測試（報名、金流對帳、登入、後台操作）
```

`.dev.vars`（不進版控，換電腦要重建）：

```
ADMIN_DEV_BYPASS=true
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

（Turnstile 為 Cloudflare 官方「永遠通過」的測試金鑰）

### 自動化測試

`test/` 底下用 Vitest + `@cloudflare/vitest-plugin`，在 Workers 真實執行環境與本機 D1 中執行，涵蓋：名額與候補、併發不超收、逾期釋出名額、金額防竄改、輸入驗證、重複報名、次數限制、正式網域保護、對帳（正確／重複通知／金額不符／逾期入帳／查無帳號／重複繳費／已取消）、後台登入（密碼、失敗次數、fail closed、本機略過限制、Access、CSRF）、後台操作、CSV 公式注入、內容後台 GitHub 登入。push 到 GitHub 時會自動執行（`.github/workflows/test.yml`）。

本機後台登入：`.dev.vars` 的 `ADMIN_DEV_BYPASS=true`（只在 localhost／127.0.0.1 生效）。

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

### 防機器人（Cloudflare Turnstile，正式開放報名前設定）

1. Cloudflare 後台 → **Turnstile → Add widget**，網域填網站網址，模式選 **Managed**
2. Site key 填進 `wrangler.jsonc` 的 `TURNSTILE_SITE_KEY`；Secret key 用 `npx wrangler secret put TURNSTILE_SECRET_KEY` 設定
3. 未設定時略過驗證（仍有每個 IP 每分鐘 5 次的報名次數限制）

### 報名管理後台登入方式

依優先順序（`src/worker/auth.ts`），**都沒設定時後台一律拒絕存取**：

1. **Cloudflare Access（建議）**：Cloudflare Zero Trust 為 `/admin*`、`/api/admin/*` 建立 Access 應用程式，允許行政人員的 Email；再設定環境變數 `ACCESS_TEAM_DOMAIN`（例如 `storykids.cloudflareaccess.com`）與 `ACCESS_AUD`
2. **暫時密碼**：`ADMIN_PASSWORD`（secret），瀏覽器會跳出帳號密碼視窗，帳號任意
3. **本機開發**：`.dev.vars` 的 `ADMIN_DEV_BYPASS=true`（只在 localhost／127.0.0.1 生效）

密碼登入失敗同一個 IP 每分鐘超過 10 次會暫時擋下（`LOGIN_LIMITER`）。

### 資料庫異動

新增 `migrations/000X_xxx.sql` → 本機 `npm run db:migrate:local` 測試 → 正式 `npm run db:migrate:remote`。

## 安全機制

| 風險 | 防護 |
|---|---|
| 竄改金額 | 金額由伺服器依 `/data/sessions.json` 決定，忽略前端送來的值 |
| 多人同時報名超收 | 名額判斷與寫入在同一個 SQL 指令完成 |
| 灌假報名佔名額 | Turnstile、每個 IP 每分鐘 5 次、防機器人隱藏欄位、同學生同時段不可重複報名 |
| 偽造入帳 | 台新通知尚未開放（501）；模擬入帳只限後台＋測試模式 |
| 重複入帳 | 銀行交易序號 UNIQUE |
| 逾期入帳／金額不符／重複繳費／已取消仍入帳 | 不自動改為已付費，標記「需人工確認」並通知公司信箱 |
| 測試模式誤上正式站 | 正式網域（`PRODUCTION_HOSTS`）上 `PAYMENT_MODE` 不是 `live` 時拒絕報名 |
| 後台暴力破解 | 登入失敗次數限制；正式上線改用 Cloudflare Access |
| 後台忘記設定登入 | 未設定任何登入方式時一律拒絕 |
| CSRF | 會修改資料的請求須來自同一網域 |
| XSS／CSV 公式注入 | 輸出時跳脫；CSV 開頭為 = + - @ 的欄位加單引號 |
| 內容後台程式被竄改 | Sveltia 主程式加 SRI 完整性檢查（選用功能的延伸模組仍由 CDN 依版本載入） |

## 注意事項

- **個資只存在 D1**，絕不寫進 GitHub；匯出的 Excel 請妥善保管
- 內容後台存檔會直接 commit 到 GitHub，本機修改前先 `git pull`
- 內容後台的欄位預設為必填，選填欄位要在 `public/cms/config.yml` 加 `required: false`；清空的欄位可能寫入 `null` 或空字串，`content.config.ts` 的選填欄位必須接受 nullish
- 舊網站網址轉址在 `public/_redirects`（不支援比對查詢參數）
