// 主選單（含下拉子選單）。子選單由內容自動產生：
// 後台新增「關於講堂」頁面或課程後，選單會自動出現，不需要改程式。
import { getCourses, getPages } from './content';
import { navItems } from './site';

export interface NavItem {
  label: string;
  href: string;
  children?: { label: string; href: string }[];
}

export async function getNav(): Promise<NavItem[]> {
  const [about, info, courses] = await Promise.all([getPages('about'), getPages('info'), getCourses()]);
  const children: Record<string, NavItem['children']> = {
    '/about': about.map((p) => ({ label: p.data.title, href: `/about/${p.id}` })),
    '/courses': courses.map((c) => ({ label: c.data.title, href: `/courses/${c.id}` })),
    '/info': info.map((p) => ({ label: p.data.title, href: `/info/${p.id}` })),
  };
  return navItems.map((item) => {
    const sub = children[item.href];
    return sub?.length ? { ...item, children: sub } : item;
  });
}
