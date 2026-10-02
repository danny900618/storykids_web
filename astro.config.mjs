// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // 正式網域：用於 canonical、Open Graph 與 sitemap.xml
  site: 'https://storykids.com.tw',
  // 產生 /news/xxx/index.html 形式，Cloudflare Pages 可直接以 /news/xxx 存取
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
