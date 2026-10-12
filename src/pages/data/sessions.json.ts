// 建置時產生 /data/sessions.json：所有課程的上課時段（名額、費用）
// 後端 Worker 讀這份檔案決定名額與應繳金額，所以永遠與目前部署的 CMS 內容一致，家長無法竄改金額
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getCourses } from '../../lib/content';

export const GET: APIRoute = async () => {
  const [courses, policies] = await Promise.all([getCourses(), getCollection('policies')]);
  const policyTitle = (id?: string) => policies.find((p) => p.id === id)?.data.title ?? '';
  const sessions = courses.flatMap((c) =>
    // 沒有代號的時段不開放報名（不列入）
    c.data.sessions.flatMap((s) => (s.code ? [{ ...s, code: s.code }] : [])).map((s) => ({
      code: s.code,
      name: s.name,
      period: s.period ?? '',
      time: s.time ?? '',
      capacity: s.capacity,
      price: s.price,
      open: s.open,
      course_id: c.id,
      course_title: c.data.title,
      category: c.data.category,
      cycle: c.data.cycle ?? '',
      fee_note: c.data.fee_note ?? '',
      location: s.location ?? c.data.location ?? '故事講堂',
      // 報名須知（報名頁第二步顯示，家長同意的辦法名稱也會存進報名資料）
      makeup_rule: policyTitle(c.data.makeup_rule) ? c.data.makeup_rule : '',
      makeup_rule_title: policyTitle(c.data.makeup_rule),
      refund_rule: policyTitle(c.data.refund_rule) ? c.data.refund_rule : '',
      refund_rule_title: policyTitle(c.data.refund_rule),
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
