// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import remarkBreaks from 'remark-breaks';

export default defineConfig({
  // 正式網域：用於 canonical、Open Graph 與 sitemap.xml
  site: 'https://storykids.com.tw',
  // 產生 /news/xxx/index.html 形式，Cloudflare Pages 可直接以 /news/xxx 存取
  trailingSlash: 'ignore',
  // 報名頁與報名管理後台不列入 sitemap
  integrations: [sitemap({ filter: (page) => !page.includes('/admin') && !page.includes('/register') })],
  // 內文的單一換行就顯示為換行（內容後台編輯時按 Enter 換行，網站上也換行，與後台預覽一致）
  // 使用 unified（remark）處理 Markdown，才能用 remark-breaks（Astro 7 預設的 Sätteri 沒有換行選項）
  markdown: {
    // smartypants：「--」轉短破折號（與原本 Sätteri 相同）；不自動轉換引號（中文旁邊的引號會轉錯方向）
    processor: unified({ remarkPlugins: [remarkBreaks], smartypants: { dashes: 'oldschool', quotes: false } }),
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
