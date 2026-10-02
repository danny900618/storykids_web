// 網站設定與共用小工具
import siteData from '../content/site.json';

// 後台清空欄位時可能寫入 null，統一轉成空字串，頁面只需判斷有沒有值
export const site = Object.fromEntries(
  Object.entries(siteData).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : ''])
) as Record<keyof typeof siteData, string>;

// 主選單：首頁 Header 與手機選單共用
export const navItems = [
  { label: '關於講堂', href: '/about' },
  { label: '最新消息', href: '/news' },
  { label: '課程介紹', href: '/courses' },
  { label: '上課須知', href: '/info' },
  { label: '幫孩子鼓掌', href: '/gallery' },
  { label: '聯絡我們', href: '/contact' },
];

// 報名連結：優先使用課程自己的連結 → 網站設定的報名連結 → LINE → 聯絡頁
export function registrationHref(override?: string): string {
  return override || site.registration_url || site.line_url || '/contact';
}

// 是否為外部連結（外部連結以新分頁開啟）
export function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}

// 日期格式：2026-09-19
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 從 Markdown 內文擷取純文字摘要
export function excerpt(markdown: string | undefined, length = 80): string {
  if (!markdown) return '';
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 圖片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 連結保留文字
    .replace(/<[^>]+>/g, '') // HTML 標籤
    .replace(/[#>*_`~-]/g, '') // Markdown 符號
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

// 取出 YouTube 影片 ID：支援完整網址、短網址或直接貼 ID
export function youtubeId(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const match = input.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
  if (match) return match[1];
  return /^[\w-]{11}$/.test(input.trim()) ? input.trim() : undefined;
}

// 電話號碼轉 tel: 連結
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
