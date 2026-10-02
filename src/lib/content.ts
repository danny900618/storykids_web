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

export async function getPages(section: 'about' | 'info') {
  const items = await getCollection(
    'pages',
    ({ data }) => data.published && data.section === section,
  );
  return items.sort((a, b) => a.data.order - b.data.order);
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
