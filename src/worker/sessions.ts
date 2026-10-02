// 讀取上課時段：來自建置時產生的靜態檔 /data/sessions.json（內容與目前部署的 CMS 一致）
import type { Env, Session } from './env';
import { holdsSeatSql, nowIso } from './env';

let cache: { at: number; data: Session[] } | null = null;

export async function loadSessions(env: Env, request: Request): Promise<Session[]> {
  // 同一個 Worker 執行個體內快取 60 秒
  if (cache && Date.now() - cache.at < 60_000) return cache.data;
  const res = await env.ASSETS.fetch(new Request(new URL('/data/sessions.json', request.url)));
  if (!res.ok) throw new Error(`讀取 sessions.json 失敗：${res.status}`);
  const data = (await res.json()) as Session[];
  cache = { at: Date.now(), data };
  return data;
}

export async function findSession(env: Env, request: Request, code: string): Promise<Session | undefined> {
  return (await loadSessions(env, request)).find((s) => s.code === code);
}

export interface SessionCount {
  session_code: string;
  taken: number; // 佔用名額的正取人數
  waitlist: number; // 候補人數（未取消）
}

// 各時段已佔名額與候補人數
export async function countBySession(env: Env): Promise<Map<string, SessionCount>> {
  const now = nowIso();
  const { results } = await env.DB.prepare(
    `SELECT session_code,
       SUM(CASE WHEN ${holdsSeatSql('?1')} THEN 1 ELSE 0 END) AS taken,
       SUM(CASE WHEN admission = '候補' AND status NOT IN ('取消報名', '轉至其他梯次') THEN 1 ELSE 0 END) AS waitlist
     FROM registrations GROUP BY session_code`,
  )
    .bind(now)
    .all<SessionCount>();
  return new Map(results.map((r) => [r.session_code, r]));
}
