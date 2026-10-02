# CLAUDE.md

開工前先讀 [project.yaml](project.yaml)：專案背景、已確定的決策、待確認事項、任務狀態都在那裡。決策或任務有變動時，請同步更新 project.yaml 並在 `changelog` 記一筆。

## 規則

- 官網只放公開內容。**任何學生/家長個資都不得進入此 repo**（報名資料屬於 phase2 的獨立系統）。
- 內容（消息、課程、頁面、網站設定）放在 `src/content/`，由 Pages CMS（`.pages.yml`）編輯；新增內容欄位時，要同步更新 `src/content.config.ts` 與 `.pages.yml`。
- 不使用 Tailwind CDN、不在前端用 JS 渲染內容；內容一律於建置時產生 HTML。
- 程式註解與 UI 文字使用繁體中文。
- 圖片放在 `public/images/`（後台上傳也存這裡，內容欄位存 `/images/...` 路徑）；PDF 放 `public/files/`。`public/images/old/` 是從舊站搬來的圖片。
- Pages CMS 清空欄位時會寫入 `null`，`content.config.ts` 的選填欄位必須接受 nullish。
- 舊站網址轉址寫在 `public/_redirects`（Cloudflare Pages 不支援比對查詢參數）。

## 指令

```sh
npm install
npm run dev      # 本機開發 http://localhost:4321
npm run build    # 輸出到 dist/
npm run preview
```
