# CLAUDE.md

開工前先讀 [project.yaml](project.yaml)（規格、決策、待確認事項、任務狀態）與 [README.md](README.md)（架構、使用的服務、部署方式）。決策或任務有變動時，請同步更新 project.yaml 並在 `changelog` 記一筆。

## 規則

- **密碼與密鑰的值絕不寫進 repo**：清單在 `docs/credentials.md`（只有名稱、用途、位置），新增或移除密鑰時同步更新該檔與 `scripts/credentials-template.mjs`。
- **個資（學生、家長、報名資料）只能存在 Cloudflare D1**，絕不寫進 repo、內容檔或 log。舊站匯出的報名 xls 放 `old_class/`（已 gitignore），用 `scripts/import-legacy.mjs` 匯入；清除測試資料時要保留 `legacy_term` 不為空的舊站資料。
- 內容（消息、課程類別、課程與上課時段、報名辦法、頁面、老師、相簿、網站設定）放在 `src/content/`，由內容後台 `/cms`（Sveltia CMS，設定檔 `public/cms/config.yml`）編輯；新增內容欄位時，要同步更新 `src/content.config.ts` 與 `public/cms/config.yml`。Sveltia 欄位預設必填，選填欄位要加 `required: false`。內文編輯器的自訂按鈕（插入下載檔案）在 `public/cms/editor-components.js`，改輸出格式時 `pattern` 要一起改。
- 不使用 Tailwind CDN、不在前端用 JS 渲染內容；內容一律於建置時產生 HTML。例外：額滿狀態、報名表、報名管理後台需要即時資料，透過 `/api/*` 取得。前台不顯示名額與剩餘名額。
- 報名欄位檢查集中在 `src/worker/profile.ts`（線上報名與後台編輯共用）。
- 程式註解與 UI 文字使用繁體中文。
- Markdown 用 unified＋remark-breaks（`astro.config.mjs`）：內文單一換行即換行；修改 markdown 設定後本機要清快取（`rm -rf .astro node_modules/.astro`）再建置，否則內容不會重新渲染。
- 圖片放在 `public/images/`（後台上傳也存這裡，內容欄位存 `/images/...` 路徑）；PDF 放 `public/files/`。`public/images/old/` 是從舊站搬來的圖片。
- 後台清空欄位時可能寫入 `null` 或空字串，`content.config.ts` 的選填欄位必須接受 nullish。
- 部署在 Cloudflare Workers（測試與正式兩個 Worker），設定在 `wrangler.jsonc`；只有 `/api/*`、`/admin` 會經過 `src/worker/`，其餘為靜態檔（含 `/cms`）。內容後台的 GitHub 登入在 `src/worker/cms-auth.ts`。舊站網址轉址寫在 `public/_redirects`（不支援比對查詢參數）。
- 後端（`src/worker/`）：
  - 名額判斷與寫入必須在同一個 SQL 指令完成（見 `register.ts`），避免併發超收。
  - 對帳一律走 `payment.ts` 的 `reconcile()`（台新入帳通知與模擬入帳共用），以交易序號 `ref` 防止重複入帳。
  - 後台 API 一律經過 `auth.ts` 驗證；沒有設定任何登入方式時必須拒絕存取（fail closed）。
  - 系統健康檢查在 `health.ts`（正式環境 Cron 每小時，有問題寄信給 `HEALTH_ALERT_TO`）；新增會影響服務的額度或外部依賴時，考慮加進檢查。
  - 金流、簡訊、Email 由 `*_MODE` 環境變數控制，`mock` 為測試模式（不對外發送）。
  - 台新銷帳檔：台新 sFTP 上傳到轉發主機，主機轉交到 `/api/taishin/file`（`bank-files.ts`，需 `TAISHIN_FILE_KEY`），原始檔保存在 D1 `bank_files`；解析後一律走 `reconcile()`。
  - 虛擬帳號依台新公式 5（`taishin.ts`）：截止日與金額編在帳號裡，改期限（例如遞補）要重新產生帳號；測試模式檢查碼故意錯誤。
  - 三竹簡訊只接受台灣固定 IP：經由 `relay/` 的轉發主機（AWS，Caddy）發送，Worker 帶 `SMS_RELAY_KEY`。修改轉發設定時 `relay/Caddyfile` 與 `relay/setup.sh` 內嵌版本要一致（`npm run relay:check`）。
- 資料表異動用 `migrations/` 新增檔案，不要修改已套用的 migration；要套用到測試（`npm run db:migrate:remote`）與正式（`npm run db:migrate:production`）兩個資料庫。
- 兩套環境：測試 `storykids-web`（最上層設定）、正式 `storykids-web-production`（`wrangler.jsonc` 的 `env.production`，不繼承 vars／D1／ratelimits，改設定兩邊都要改）。正式環境的 wrangler 指令都要加 `--env production`。
- 後台存檔會直接 commit 到 GitHub：修改前先 `git pull`。

## 指令

```sh
npm install
npm run dev               # 只有網頁 http://localhost:4321
npm run db:migrate:local  # 建立本機資料庫
npm run dev:full          # 網頁 + 後端 + 本機 D1 http://localhost:8787
npm run check             # 網頁型別檢查
npm run check:worker      # 後端型別檢查
npm run build             # 輸出到 dist/
```
