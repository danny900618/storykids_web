// 讀取內容集合：統一過濾「未啟用」並排序，頁面只需呼叫這些函式
import { getCollection } from 'astro:content';

export async function getNews() {
  const items = await getCollection('news', ({ data }) => data.published);
  return items.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export async function getCourses() {
  const items = await getCollection('courses', ({ data }) => data.published);
  return items.sort(
    (a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title, 'zh-Hant'),
  );
}

// 課程依類別分組：類別依「課程類別」的排序；課程的類別找不到對應（例如類別改名後課程沒重選）時自成一組排在最後
// 只回傳有課程的類別；id 為類別頁網址 /courses/category/[id]（找不到對應類別的組沒有 id）
export async function getCourseGroups() {
  const [courses, categories] = await Promise.all([
    getCourses(),
    getCollection('categories', ({ data }) => data.published),
  ]);
  categories.sort((a, b) => a.data.order - b.data.order);
  const groups = categories.map((c) => ({
    id: c.id as string | undefined,
    title: c.data.title,
    description: c.data.description,
    courses: courses.filter((course) => course.data.category === c.data.title),
  }));
  // 類別未啟用（published: false）的課程不顯示；完全找不到類別的課程才自成一組
  const allTitles = new Set((await getCollection('categories')).map((c) => c.data.title));
  for (const course of courses) {
    if (allTitles.has(course.data.category)) continue;
    let group = groups.find((g) => !g.id && g.title === course.data.category);
    if (!group) groups.push((group = { id: undefined, title: course.data.category, description: undefined, courses: [] }));
    group.courses.push(course);
  }
  return groups.filter((g) => g.courses.length > 0);
}

export async function getPages(section: 'about' | 'info') {
  const items = await getCollection(
    'pages',
    ({ data }) => data.published && data.section === section,
  );
  return items.sort((a, b) => a.data.order - b.data.order);
}

export async function getTeachers() {
  const items = await getCollection('teachers', ({ data }) => data.published);
  return items.sort((a, b) => a.data.order - b.data.order);
}

// 只有 YouTube 影片、沒有任何照片的項目 → 在「幫孩子鼓掌」頁最上方直接播放
const isVideoOnly = (data: { youtube?: string; images: string[]; cover?: string }) =>
  !!data.youtube && data.images.length === 0 && !data.cover;

export async function getGalleryVideos() {
  return (await getGallery()).filter((a) => isVideoOnly(a.data));
}

// 圖文故事（列表與首頁顯示用）
export async function getGalleryStories() {
  return (await getGallery()).filter((a) => !isVideoOnly(a.data));
}

export async function getGallery() {
  const items = await getCollection('gallery', ({ data }) => data.published);
  // 有日期的排前面（新到舊），沒有日期的依 order 排序
  return items.sort((a, b) => {
    const da = a.data.date?.valueOf();
    const db = b.data.date?.valueOf();
    if (da !== undefined && db !== undefined) return db - da;
    if (da !== undefined) return -1;
    if (db !== undefined) return 1;
    return a.data.order - b.data.order;
  });
}
