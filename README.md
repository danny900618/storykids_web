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
| 網路中文 | 網域 storykids.com.tw 註冊（到期 2028-04-17） | 每年續約 | ⚠️ 目前註冊人為「魔瓶視覺設計」，需過戶給補習班 |
| 三竹簡訊 | 報名、繳費簡訊 | 每則計費 | ✅ 已串接，經由轉發主機發送（三竹白名單：52.194.121.120），測試環境實測成功 |
| AWS Lightsail（東京） | 三竹簡訊轉發主機 `storykids-sms-relay`，固定 IP 52.194.121.120（[relay/](relay/README.md)） | 約 US$5／月，**綁信用卡、每月自動扣款** | 已建立（2026-10-13） |
| 台新銀行 | 虛擬帳號代收、自動對帳 | 代收手續費 | **尚未串接** |
| 寄信服務（建議 Brevo） | 報名確認信，寄件人 `故事講堂 <service@storykids.com.tw>` | 免費每天 300 封 | **尚未串接** |

- 預覽網址：https://storykids-web.c0981985611.workers.dev
- 正式網址：https://storykids.com.tw（DNS 尚未切換）

帳號與密鑰清單（名稱、用途、存放位置、怎麼重新產生，**不含值**）：[docs/credentials.md](docs/credentials.md)；Bitwarden 匯入範本：`npm run credentials:template`。

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
| 網域（網路中文） | 年費 | 視網路中文設定 | — | **忘記續約網站會打不開**，建議開自動續約 |

**之後串接時會新增的費用**（依合約為準）：AWS 簡訊轉發主機（約 US$5～8／月，綁卡自動扣款，需設定預算通知，見 [relay/README.md](relay/README.md)）、三竹簡訊（每則計費，通常為**預付點數，點數用完簡訊就停**，要留意餘額）、台新代收手續費（每筆）、寄信服務（Brevo 免費每天 300 封，超過當天停止寄送或升級付費）。

**選配：Cloudflare Workers Paid（每月 US$5）**：額度提高到每月 1,000 萬次請求，超過才按量計費。**需要綁信用卡、每月自動扣款**，Cloudflare 沒有消費上限設定。正式開放報名、擔心尖峰時段時再考慮升級。

來源：[Workers 價格](https://developers.cloudflare.com/workers/platform/pricing/)、[D1 價格](https://developers.cloudflare.com/d1/platform/pricing/)、[Workers Builds 限制](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)、[靜態資源計費](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)

## 兩個後台

| | 內容管理（/cms） | 報名管理（/admin） |
|---|---|---|
| 網址 | https://網站網址/cms | https://網站網址/admin |
| 登入 | GitHub 帳號 | Cloudflare Access（Email 驗證碼）或暫時密碼 |
| 管什麼 | 網站內容，**包含課程類別、課程的「上課時段」（名額、費用、代號）、報名辦法（補課／退費）** | 報名資料：正取／候補、狀態、繳費、編輯家長資料與優待金額、匯出 Excel、通知紀錄、舊站匯入資料 |
| 資料在哪 | GitHub | Cloudflare D1 |
| 設定檔 | [public/cms/config.yml](public/cms/config.yml)、登入 [src/worker/cms-auth.ts](src/worker/cms-auth.ts) | [src/worker/](src/worker/)、[src/pages/admin/](src/pages/admin/) |

兩邊以「**時段代號**」串接：建置時把所有上課時段輸出成 `/data/sessions.json`，後端依此判斷名額與應繳金額。時段代號由內容後台**自動產生、不可修改**（Sveltia `uuid` 欄位）；萬一缺少代號，該時段只顯示、不開放報名。**已有人報名的時段不要刪除**（要停止報名請取消「開放報名」；若被刪除，報名管理後台會顯示警告，原報名資料仍保留）。

## 報名流程

1. 沿用舊站三步驟：**課程預約**（課程頁選時段）→ `/register?session=代號` **資料填寫**（顯示課程選定的補課辦法、退費辦法，勾選同意才能下一步）→ **完成報名**（填寫舊站的報名欄位後送出）。前台不顯示名額與剩餘名額，額滿時按鈕顯示「額滿請候補」
2. 後端以單一 SQL 判斷名額並寫入（多人同時報名不會超收）
   - 名額內 → **正取**，狀態「等待付費」，產生虛擬帳號，繳費期限為報名日起第 3 天 23:59
   - 額滿 → **候補**，狀態「待處理」，**不產生帳號**
3. 寄出通知：家長 Email＋簡訊、公司信箱（`COMPANY_EMAIL`）
4. 入帳 → 對帳（`src/worker/payment.ts` 的 `reconcile()`）→「已付費」→ 寄收據
5. 逾期未繳自動釋出名額（不需排程，計算名額時排除）；行政可在後台把候補遞補為正取（自動產生帳號並通知）
6. 後台點學生姓名可修改家長填錯的資料，並填「優待金額」（只做顯示，不改應繳金額與已產生的繳費帳號）

### 課程類別與報名辦法（內容後台）

- **課程類別**：選單「課程介紹」的下拉選單（`/courses/category/[id]`）。課程的類別欄位存的是**類別名稱**，內容後台的課程列表依類別分組；類別改名後要把該類別的課程重新選一次（找不到類別的課程會自成一組顯示，不會消失）
- **報名辦法**：補課辦法、退費辦法各自可建多份（例如寒暑假營隊、學期班），每個課程各選一份（必填），報名第二步顯示；家長同意的辦法名稱會存在報名資料的 `agreed_policies`

### 內文插入下載檔案

內文編輯器工具列有「**插入下載檔案**」按鈕（下載圖示，`public/cms/editor-components.js`）：選擇或上傳檔案（存到 `public/files/`）→ 輸入顯示文字 → 插入。
內文存成 `<a href="/files/…" data-download-link …>文字</a>`，網站顯示為前面有下載圖示的粗體連結（`global.css` 的 `.prose-story a[data-download-link]`）。

### 每學期開新課程（複製上學期的課程）

不另外做「複製類別」工具（2026-10-12 決定），用內容後台內建的「建立副本」逐篇複製（英文介面為 Duplicate）：

1. 「課程類別」→ 新增類別（例如「學期班（11602學期）」），**先不要勾「啟用」**
2. 進入上學期的課程 → 按「建立副本」（出現「項目已複製為新草稿。」）→ 類別改選新類別、修改上課時段的日期與名額、存檔（複製時時段代號會自動重新產生，不會跟舊時段衝突）
3. 其他課程重複第 2 步
4. 全部改好後，新類別勾「啟用」；上學期的類別取消「啟用」（課程從網站消失，資料保留，已報名的資料不受影響）

注意：類別未啟用時，課程不會出現在選單與課程介紹，但上課時段仍會被列入報名資料；改好日期前可先把時段的「開放報名」取消。

### 舊站報名資料

舊站後台匯出的「課程報名-梯次.xls」用 [scripts/import-legacy.mjs](scripts/import-legacy.mjs) 轉成 SQL 匯入 D1（檔案含個資，放在 `old_class/`，已加入 `.gitignore`，絕不 commit）：

```sh
node scripts/import-legacy.mjs old_class /tmp/legacy.sql
npx wrangler d1 execute DB --remote --env production --file /tmp/legacy.sql   # 正式；測試環境去掉 --env production，本機改 --local
rm /tmp/legacy.sql
```

- 同一份檔案重複匯入不會重複（梯次＋舊站編號唯一）。上線前再匯出最新一次重新匯入即可補齊
- 舊站資料沒有報名時間與金額：後台顯示「舊站 梯次」，金額記 0；舊站虛擬帳號存在 `legacy_va`（不放 `va_account`，避免與新帳號衝突或被自動對帳誤認）
- 時段代號為 `old-` 開頭（不在 CMS，不會被當成已刪除的時段）；舊站資料不能遞補正取／候補，其他欄位與狀態可以修改
- ⚠️ 清除測試報名時要保留舊站資料：`DELETE ... WHERE legacy_term IS NULL`

### 測試模式（目前）

`wrangler.jsonc` 的 `MAIL_MODE`／`SMS_MODE`／`PAYMENT_MODE` 都是 `mock`：

- 虛擬帳號是假資料（`96989` + 報名編號 + 假檢查碼）
- Email、簡訊不會寄出，內容寫進 `notifications` 資料表，在後台「紀錄」可以看到
- 後台每筆有「模擬入帳」按鈕，走跟台新入帳通知相同的對帳流程

### 尚未串接（拿到資料後要做的事）

| 項目 | 要改的地方 |
|---|---|
| 台新虛擬帳號規則 | ✅ 已依台新公式 5 實作（`src/worker/taishin.ts`）：96989＋報名編號後 4 碼＋繳款截止日＋檢查碼（含金額）。測試模式檢查碼故意錯誤，銀行不會收款；正式模式（`PAYMENT_MODE=live`）才產生可繳費的帳號 |
| 台新入帳資料 | ✅ 台新以 sFTP 上傳銷帳檔到轉發主機（[relay/](relay/README.md)），主機轉交 `/api/taishin/file`，解析後逐筆 `reconcile()`；HTTPS 即時通知月費 NT$5,000，不使用。待台新啟用 sFTP 並以測試檔驗證 |
| 三竹簡訊 | **已串接**（`sendSmsLive()`，HTTP API SmSend）。三竹只接受台灣固定 IP，Cloudflare 連不到：要先架轉發主機（[relay/README.md](relay/README.md)），再把 `MITAKE_API_URL` 改為轉發主機、設定 `SMS_RELAY_KEY`。帳密用 `wrangler secret put MITAKE_USERNAME`／`MITAKE_PASSWORD`；發送網址 `MITAKE_API_URL`（企業／個人帳號不同）。測試通過後把 `SMS_MODE` 改為 `live`；後台「發測試簡訊」可測試（會扣點數），右上角顯示剩餘點數 |
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
│   └── worker/               # 後端：index（路由）、register、profile（報名欄位檢查）、admin、auth、payment、notify、sessions、cms-auth（內容後台登入）
├── scripts/import-legacy.mjs # 匯入舊站報名資料（xls → SQL）
├── relay/                    # 三竹簡訊轉發主機（AWS，固定 IP）：Caddy 設定、啟動指令碼、安裝步驟
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

### 兩套環境

程式與網站內容（`src/content/`）兩邊相同，**資料庫、密鑰與模式設定分開**，測試報名不會進入正式名單：

| | 測試環境 | 正式環境 |
|---|---|---|
| Worker | `storykids-web` | `storykids-web-production` |
| 網址 | https://storykids-web.c0981985611.workers.dev | https://storykids-web-production.c0981985611.workers.dev（上線時綁 storykids.com.tw） |
| 資料庫（D1） | `storykids`：測試報名（另有一份舊站名單副本） | `storykids-production`：正式報名＋舊站學生名單 |
| 設定 | `wrangler.jsonc` 最上層 | `wrangler.jsonc` 的 `env.production`（**不繼承**最上層的 vars、D1、ratelimits，改設定兩邊都要改） |
| 模式 | 永遠 `mock` | 上線時改 `live`；`PAYMENT_MODE` 不是 `live` 前不開放報名 |
| 部署指令 | `npx wrangler deploy` | `npx wrangler deploy --env production`（或 `npm run deploy:production`） |
| 資料表異動 | `npm run db:migrate:remote` | `npm run db:migrate:production` |

報名管理後台頁首會顯示「測試環境」（藍）或「正式環境」（綠）。內容後台 `/cms` 兩邊共用：存檔 commit 到 `main` 後兩邊都會重新部署。

push 到 `main` 後，Cloudflare Workers Builds 會自動建置並部署兩個 Worker（各自在 Cloudflare 後台連結 GitHub repo，2026-10-14 兩邊皆已設定完成）：

| Worker | Build command | Deploy command | 非 main 分支 |
|---|---|---|---|
| `storykids-web` | `npm run build` | `npx wrangler deploy` | 開啟（產生預覽網址，先測新程式） |
| `storykids-web-production` | `npm run build` | `npx wrangler deploy --env production` | 關閉 |

⚠️ 密鑰（secret）兩邊分開設定，正式環境的指令都要加 `--env production`，例如 `npx wrangler secret put ADMIN_PASSWORD --env production`。
⚠️ 有新的 migration 時，**先套用到兩個資料庫**再 push。

### 第一次啟用報名系統（只需做一次）

```sh
npx wrangler login                                        # 登入 Cloudflare 帳號
npx wrangler d1 create storykids-production --location apac  # 建立資料庫 → 把 database_id 填進 wrangler.jsonc
npm run db:migrate:production                             # 建立資料表
npx wrangler secret put ADMIN_PASSWORD --env production   # 暫時的後台密碼（正式建議改用 Cloudflare Access）
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

新增 `migrations/000X_xxx.sql` → 本機 `npm run db:migrate:local` 測試 → 測試環境 `npm run db:migrate:remote` → 正式環境 `npm run db:migrate:production` → 再 push 程式。

## 資料備份與還原

- **D1 Time Travel**（自動開啟）：可把資料庫還原到 **7 天內**任一分鐘（Workers Paid 為 30 天）。還原會**覆蓋**目前資料，還原後會回傳可復原的 bookmark
  ```sh
  npx wrangler d1 time-travel info DB --env production                         # 查看目前 bookmark
  npx wrangler d1 time-travel restore DB --env production --timestamp=UNIX時間  # 還原到指定時間
  ```
- **每月手動匯出**：報名管理後台「匯出 Excel」（來源選「全部（含舊站）」），存到補習班自己的空間，只限負責人存取（含個資）
- 自動備份（T26）暫緩，正式開放報名後再評估

## 監控

| 監測 | 方式 | 通知 |
|---|---|---|
| 正式網站、報名系統 API、轉發主機、網域到期 | **UptimeRobot**（免費，每 5 分鐘；設定見 project.yaml T48） | Email：開發者、補習班負責人 |
| Email 寄送量、寄送失敗、三竹點數、銷帳檔、需人工確認、轉發主機 | **系統健康檢查**（`src/worker/health.ts`，正式環境 Cron 每小時；同一問題 24 小時內只寄一次） | Email：`HEALTH_ALERT_TO`；報名管理後台上方也會顯示 |
| 轉發主機當機 | Lightsail Status check 警報（relay/README.md 第 11 步） | Email |
| AWS 費用 | AWS Budgets（每月 US$15） | Email |
| 三竹點數 | 報名管理後台右上角（低於 200 點變紅） | 人工查看 |
| 通知寄送結果 | 報名管理後台每筆「紀錄」 | 人工查看 |
| 台新銷帳檔 | 報名管理後台頁首「台新資料：最近一次」與「台新銷帳檔」區塊 | 人工查看 |

**需要留意的額度**：Brevo 免費方案**每天 300 封**（每筆報名約 2～3 封），營隊開放報名當天可能用完 → 開放報名前可先升級一個月；三竹為預付點數，用完簡訊即停止。
Cloudflare、D1、GitHub 的額度以目前用量估算都很充裕。

## 定期維護清單

| 頻率 | 項目 | 說明 |
|---|---|---|
| **每年（必做）** | **網域續約** | 網路中文，下次到期 **2028-04-17**；過期網站與信箱全部停擺。開啟自動續約、確認信用卡與聯絡 Email 有效 |
| 每次報名季前 | 確認上課時段 | 內容後台的時段、名額、費用、「開放報名」 |
| 每次報名季前 | 端對端測試 | 報名 → Email／簡訊 → 入帳 → 繳費完成通知 |
| 每次報名季前 | 三竹簡訊點數 | 報名管理後台右上角顯示剩餘點數，不足先儲值 |
| 每次報名季前（選配） | 流量預估 | 預期尖峰很大時可暫時升級 Workers Paid（US$5／月） |
| 每半年～一年 | 人員帳號 | 移除離職人員：GitHub 協作者（/cms）、Cloudflare Access 白名單（/admin） |
| 每半年～一年 | 報名資料備份 | 報名管理後台匯出 Excel；或 `npx wrangler d1 export storykids --remote --output=backup.sql` |
| 每半年～一年 | 套件更新 | `npm outdated` → 更新 → `npm test`、`npm run check`；Sveltia 升版要重算 `public/cms/index.html` 的 SRI |
| 每半年～一年 | 廠商帳號 | 三竹密碼若有定期更換規定，更新 `MITAKE_PASSWORD`；確認台新、Brevo 合約與費率 |

不需要處理：主機、主機系統更新、SSL 憑證、流量與防攻擊（Cloudflare 自動負責）；網站內容備份（GitHub 有完整修改紀錄）。

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
