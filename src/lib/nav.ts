// 主選單（含下拉子選單）。子選單由內容自動產生：
// 後台新增「關於講堂」頁面或課程類別後，選單會自動出現，不需要改程式。
// 「課程介紹」的子選單是課程類別（大項），點進類別再看該類別的課程，與舊站相同。
import { getCourseGroups, getPages } from './content';
import { navItems } from './site';

export interface NavItem {
  label: string;
  href: string;
  children?: { label: string; href: string }[];
}

export async function getNav(): Promise<NavItem[]> {
  const [about, info, groups] = await Promise.all([getPages('about'), getPages('info'), getCourseGroups()]);
  const children: Record<string, NavItem['children']> = {
    '/about': about.map((p) => ({ label: p.data.title, href: `/about/${p.id}` })),
    '/courses': groups.map((g) => ({ label: g.title, href: g.id ? `/courses/category/${g.id}` : `/courses#${encodeURIComponent(g.title)}` })),
    '/info': info.map((p) => ({ label: p.data.title, href: `/info/${p.id}` })),
  };
  return navItems.map((item) => {
    const sub = children[item.href];
    return sub?.length ? { ...item, children: sub } : item;
  });
}
