// 內容集合定義：src/content/ 底下的 Markdown 由 Pages CMS（.pages.yml）編輯。
// 新增或修改欄位時，請同步更新 .pages.yml，兩邊欄位名稱必須一致。
//
// 注意：Pages CMS 對「清空的欄位」會寫入 null，所以選填欄位一律用 nullish 接受，
// 再轉成 undefined / 預設值，避免後台清空欄位後網站建置失敗。
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// 選填文字（含圖片路徑 "/images/xxx.jpg"）：null 或空字串都視為未填
const optionalText = z
  .string()
  .nullish()
  .transform((v) => v?.trim() || undefined);
const bool = (fallback: boolean) =>
  z
    .boolean()
    .nullish()
    .transform((v) => v ?? fallback);
const orderNumber = z
  .number()
  .nullish()
  .transform((v) => v ?? 100);
const stringList = z
  .array(z.string())
  .nullish()
  .transform((v) => (v ?? []).filter(Boolean));

// 最新消息
const news = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/news' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    // 對應舊 CMS 的「首頁」勾選：顯示在首頁的最新消息區塊
    featured: bool(false),
    // 對應舊 CMS 的「啟用」勾選：未啟用的消息不會出現在網站上（可當草稿）
    published: bool(true),
    cover: optionalText,
    // 首頁輪播用的橫幅圖片（建議 1500×730）；未填寫時使用封面圖片
    slide_image: optionalText,
    // 列表卡片上的摘要；未填寫時自動擷取內文開頭
    summary: optionalText,
  }),
});

// 課程介紹
const courses = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/courses' }),
  schema: z.object({
    title: z.string(),
    // 班別，例如「學期班」「寒暑假營隊」
    category: z
      .string()
      .nullish()
      .transform((v) => v?.trim() || '學期班'),
    // 適合對象，例如「國小一～三年級」
    audience: optionalText,
    summary: optionalText,
    // 上課時間、人數、費用等以文字呈現，避免格式限制
    schedule: optionalText,
    class_size: optionalText,
    price: optionalText,
    cover: optionalText,
    // 對應舊 CMS 的「首頁課程」
    featured: bool(false),
    published: bool(true),
    // 排序：數字越小越前面
    order: orderNumber,
    // 個別課程的報名連結；未填寫時使用網站設定中的預設報名連結
    registration_url: optionalText,
  }),
});

// 一般頁面：關於我們（about）、上課須知與辦法（info）
const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    section: z.enum(['about', 'info']),
    order: orderNumber,
    cover: optionalText,
    description: optionalText,
    published: bool(true),
  }),
});

// 幫孩子鼓掌：相簿與影片
const gallery = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/gallery' }),
  schema: z.object({
    title: z.string(),
    // 副標題，例如課程名稱「閩南語演說」「一對一課程」
    subtitle: optionalText,
    // 列表上顯示的簡短描述；未填寫時自動擷取內文開頭
    summary: optionalText,
    // 舊站相簿沒有日期，所以日期為選填；有日期的相簿排在前面（新到舊）
    date: z.coerce.date().nullish().transform((v) => v ?? undefined),
    // 沒有日期的相簿依此排序（數字越小越前面）
    order: orderNumber,
    cover: optionalText,
    images: stringList,
    // YouTube 影片網址（可貼完整網址或影片 ID）
    youtube: optionalText,
    published: bool(true),
  }),
});

// 講堂老師：顯示在「關於講堂 › 講堂老師」頁面
const teachers = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/teachers' }),
  schema: z.object({
    name: z.string(),
    // 職稱，例如「班主任」「指導老師」
    role: optionalText,
    // 分類標籤（顯示在卡片上方），例如「課程總監」「口語表達」
    category: optionalText,
    // 學歷
    major: optionalText,
    photo: optionalText,
    order: orderNumber,
    published: bool(true),
  }),
});

export const collections = { news, courses, pages, gallery, teachers };
