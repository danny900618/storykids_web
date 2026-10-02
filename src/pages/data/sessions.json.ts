// 建置時產生 /data/sessions.json：所有課程的上課時段（名額、費用）
// 後端 Worker 讀這份檔案決定名額與應繳金額，所以永遠與目前部署的 CMS 內容一致，家長無法竄改金額
import type { APIRoute } from 'astro';
import { getCourses } from '../../lib/content';

export const GET: APIRoute = async () => {
  const courses = await getCourses();
  const sessions = courses.flatMap((c) =>
    c.data.sessions.map((s) => ({
      code: s.code,
      name: s.name,
      time: s.time ?? '',
      capacity: s.capacity,
      price: s.price,
      open: s.open,
      course_id: c.id,
      course_title: c.data.title,
    })),
  );

  // 時段代號必須全站唯一，重複時讓建置失敗，避免報名對錯時段
  const seen = new Set<string>();
  for (const s of sessions) {
    if (seen.has(s.code)) throw new Error(`上課時段代號重複：「${s.code}」，請在後台修改其中一個`);
    seen.add(s.code);
  }

  return new Response(JSON.stringify(sessions), { headers: { 'Content-Type': 'application/json' } });
};
