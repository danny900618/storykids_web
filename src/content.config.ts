// 內容集合定義：src/content/ 底下的 Markdown 由內容後台 Sveltia CMS（public/cms/config.yml）編輯。
// 新增或修改欄位時，請同步更新 public/cms/config.yml，兩邊欄位名稱必須一致。
//
// 注意：後台清空欄位時可能寫入 null 或空字串，所以選填欄位一律用 nullish 接受，
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
  .preprocess((v) => (v === '' ? undefined : v), z.number().nullish())
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
  // 沿用舊站課程頁的欄位：每個資訊獨立填寫，課程頁以固定模板顯示，通知信也直接取用這些欄位
  schema: z.object({
    // ---- 基本資料 ----
    title: z.string(),
    // 課程類別，例如「學期班（11509學期）」「115夏令營」
    category: z
      .string()
      .nullish()
      .transform((v) => v?.trim() || '學期班'),
    // 適合對象（課程卡片上的短標籤），例如「小一~小二」
    audience: optionalText,
    // 課程簡介（課程卡片上顯示）
    summary: optionalText,
    cover: optionalText,
    // 課程照片（課程頁最上方）
    images: stringList,
    // ---- 課程說明 ----
    skills: optionalText, // 培養能力
    goal: optionalText, // 課程目標
    level: optionalText, // 適合程度
    content: optionalText, // 課程內容
    practice: optionalText, // 表達練習
    video: optionalText, // 影片分享（YouTube 網址）
    // ---- 上課方式 ----
    cycle: optionalText, // 上課週期，例如「五天主題課程30小時」
    class_time: optionalText, // 上課時間，例如「早上9：00-12：00上課…」
    class_size: optionalText, // 上課人數
    makeup_policy: optionalText, // 補課辦法
    // ---- 課程學費 ----
    price: optionalText, // 預約費用（顯示用文字）
    fee_note: optionalText, // 費用說明（退費規定等），也會出現在報名通知信
    // ---- 開課訊息 ----
    schedule_file: optionalText, // 最新課表（PDF 檔案路徑）
    schedule_label: optionalText, // 最新課表的說明文字，例如「115年暑期課表」
    open_period: optionalText, // 開課期間
    signup_period: optionalText, // 報名時間
    question: optionalText, // 我有問題
    phone: optionalText, // 電話報名
    // ---- 上課時段 ----
    // 上課地點（時段沒有另外填寫時使用），也會出現在報名通知信
    location: optionalText,
    // 家長在課程頁選擇時段報名。代號（code）是報名資料對應時段的依據，由內容後台自動產生、不可修改
    // 萬一缺少代號（例如後台沒有成功產生），該時段只顯示不開放報名，不會讓網站建置失敗
    sessions: z
      .array(
        z.object({
          code: z
            .string()
            .nullish()
            .transform((v) => (v && /^[a-z0-9-]+$/.test(v.trim()) ? v.trim() : undefined)),
          name: z.string(),
          period: optionalText, // 上課期間，例如「2026-08-24~2026-08-28」
          time: optionalText, // 上課時間，例如「09:00-16:30」
          location: optionalText, // 上課地點（未填寫則用課程的上課地點）
          capacity: z.number().int().min(0),
          price: z.number().int().min(0),
          open: bool(true),
        }),
      )
      .nullish()
      .transform((v) => v ?? []),
    // ---- 其他 ----
    // 對應舊 CMS 的「首頁課程」
    featured: bool(false),
    published: bool(true),
    // 排序：數字越小越前面
    order: orderNumber,
    // 外部報名連結；未設定上課時段時使用（未填寫時用網站設定中的預設報名連結）
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
