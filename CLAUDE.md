# CLAUDE.md

開工前先讀 [project.yaml](project.yaml)（規格、決策、待確認事項、任務狀態）與 [README.md](README.md)（架構、使用的服務、部署方式）。決策或任務有變動時，請同步更新 project.yaml 並在 `changelog` 記一筆。

## 規則

- **個資（學生、家長、報名資料）只能存在 Cloudflare D1**，絕不寫進 repo、內容檔或 log。
- 內容（消息、課程與上課時段、頁面、老師、相簿、網站設定）放在 `src/content/`，由內容後台 `/cms`（Sveltia CMS，設定檔 `public/cms/config.yml`）編輯；新增內容欄位時，要同步更新 `src/content.config.ts` 與 `public/cms/config.yml`。Sveltia 欄位預設必填，選填欄位要加 `required: false`。
- 不使用 Tailwind CDN、不在前端用 JS 渲染內容；內容一律於建置時產生 HTML。例外：剩餘名額、報名表、報名管理後台需要即時資料，透過 `/api/*` 取得。
- 程式註解與 UI 文字使用繁體中文。
- 圖片放在 `public/images/`（後台上傳也存這裡，內容欄位存 `/images/...` 路徑）；PDF 放 `public/files/`。`public/images/old/` 是從舊站搬來的圖片。
- 後台清空欄位時可能寫入 `null` 或空字串，`content.config.ts` 的選填欄位必須接受 nullish。
- 部署在 Cloudflare Workers，設定在 `wrangler.jsonc`；只有 `/api/*`、`/admin` 會經過 `src/worker/`，其餘為靜態檔（含 `/cms`）。內容後台的 GitHub 登入在 `src/worker/cms-auth.ts`。舊站網址轉址寫在 `public/_redirects`（不支援比對查詢參數）。
- 後端（`src/worker/`）：
  - 名額判斷與寫入必須在同一個 SQL 指令完成（見 `register.ts`），避免併發超收。
  - 對帳一律走 `payment.ts` 的 `reconcile()`（台新入帳通知與模擬入帳共用），以交易序號 `ref` 防止重複入帳。
  - 後台 API 一律經過 `auth.ts` 驗證；沒有設定任何登入方式時必須拒絕存取（fail closed）。
  - 金流、簡訊、Email 由 `*_MODE` 環境變數控制，`mock` 為測試模式（不對外發送）。
- 資料表異動用 `migrations/` 新增檔案，不要修改已套用的 migration。
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
