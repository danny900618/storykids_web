// 通知：Email 與簡訊
// MAIL_MODE / SMS_MODE = mock（測試模式）：內容寫進 notifications 資料表，可在後台查看，不會真的寄出。
// live：Email 透過 Brevo、簡訊透過三竹簡訊發送。
import type { Env, Registration, Session } from './env';
import { formatTw, nowIso } from './env';
import { type EmailContent, renderEmailHtml, renderEmailText } from './email-template';

interface Message {
  channel: 'email' | 'sms';
  recipient: string;
  subject?: string;
  body: string; // 純文字內容（Email 的純文字版、簡訊內容）
  html?: string; // Email 的 HTML 版
}

async function deliver(env: Env, registrationId: number, msg: Message): Promise<void> {
  const mode = msg.channel === 'email' ? env.MAIL_MODE : env.SMS_MODE;
  let result = 'mock';
  let body = msg.body;
  if (mode === 'live') {
    try {
      if (msg.channel === 'email') {
        await sendEmailLive(env, msg);
      } else {
        const { accountPoint } = await sendSmsLive(env, msg, registrationId);
        // 記錄剩餘點數，後台可以看到（點數用完簡訊就停）
        if (accountPoint !== undefined) body = `${msg.body}\n\n［三竹剩餘點數 ${accountPoint}］`;
      }
      result = 'sent';
    } catch (err) {
      console.error('通知寄送失敗', err);
      result = 'failed';
      // 失敗原因附在紀錄最後，後台「紀錄」可以看到
      body = `${msg.body}\n\n［寄送失敗］${err instanceof Error ? err.message : String(err)}`;
    }
  }
  await env.DB.prepare(
    `INSERT INTO notifications (registration_id, channel, recipient, subject, body, html, result, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(registrationId, msg.channel, msg.recipient, msg.subject ?? null, body, msg.html ?? null, result, nowIso())
    .run();
}

// 「故事講堂 <service@storykids.com.tw>」→ { name, email }
export function parseAddress(value: string): { name?: string; email: string } {
  const m = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { name: m[1] || undefined, email: m[2].trim() } : { email: value.trim() };
}

// Email 正式寄送：Brevo 交易信 API（https://developers.brevo.com/reference/sendtransacemail）
// 寄件網域需先在 Brevo 驗證（DNS 加 DKIM／SPF），否則可能被拒絕或進垃圾信件匣
export async function sendEmailLive(env: Env, msg: Message, opts: { from?: string } = {}): Promise<void> {
  if (!env.BREVO_API_KEY) throw new Error('尚未設定 BREVO_API_KEY');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: parseAddress(opts.from || env.MAIL_FROM),
      to: [{ email: msg.recipient }],
      ...(env.MAIL_REPLY_TO ? { replyTo: parseAddress(env.MAIL_REPLY_TO) } : {}),
      subject: msg.subject ?? '故事講堂通知',
      textContent: msg.body,
      ...(msg.html ? { htmlContent: msg.html } : {}),
    }),
  });
  if (!res.ok) {
    // 只記錄 Brevo 回傳的錯誤訊息，不包含金鑰
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo 寄信失敗 ${res.status}：${detail.slice(0, 300)}`);
  }
}

// 後台「寄測試信」：不論 MAIL_MODE，直接用 Brevo 寄一封信，用來確認串接、寄件人設定，或預覽家長收到的通知信
// from：寄件人（需先在 Brevo 驗證過）；content：要寄的內容（未提供則寄一封簡單的測試信）
export async function sendTestEmail(
  env: Env,
  to: string,
  opts: { from?: string; content?: { subject: string; body: string; html?: string | null } } = {},
): Promise<void> {
  const content = opts.content ?? testEmailContent(env);
  await sendEmailLive(
    env,
    { channel: 'email', recipient: to, subject: content.subject, body: content.body, html: content.html ?? undefined },
    { from: opts.from },
  );
}

function testEmailContent(env: Env) {
  const c: EmailContent = {
    greeting: '您好：',
    intro: '這是故事講堂網站的寄信測試。收到這封信代表寄信串接成功。',
    rows: [
      ['寄出時間', formatTw(nowIso())],
      ['請確認', '這封信不在垃圾信件匣、寄件人顯示「故事講堂」'],
    ],
  };
  return { subject: '故事講堂 - 寄信測試', body: renderEmailText(env, c), html: renderEmailHtml(env, c) };
}

// ---- 三竹簡訊 ----
const MITAKE_DEFAULT_URL = 'https://smsapi.mitake.com.tw/api/mtk/SmSend';
// 三竹回應的狀態碼：0 預約傳送中、1／2 已送達業者、4 已送達手機 → 視為成功；其餘（英文字母等）為錯誤
const MITAKE_OK = ['0', '1', '2', '4'];

// 同一則簡訊的識別碼（三竹以 clientid 防止 12 小時內重複發送），最長 36 字元
async function smsClientId(registrationId: number | null, body: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
  const hex = [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sk${registrationId ?? 0}-${hex}`.slice(0, 36);
}

// 簡訊正式發送：三竹簡訊 HTTP API（SmSend）。回傳剩餘點數（三竹有回傳時）
export async function sendSmsLive(env: Env, msg: Message, registrationId: number | null = null): Promise<{ accountPoint?: number }> {
  if (!env.MITAKE_USERNAME || !env.MITAKE_PASSWORD) throw new Error('尚未設定三竹帳號密碼（MITAKE_USERNAME／MITAKE_PASSWORD）');
  const url = new URL(env.MITAKE_API_URL || MITAKE_DEFAULT_URL);
  url.searchParams.set('CharsetURL', 'UTF8');
  const form = new URLSearchParams({
    username: env.MITAKE_USERNAME,
    password: env.MITAKE_PASSWORD,
    dstaddr: msg.recipient,
    smbody: msg.body,
    clientid: await smsClientId(registrationId, msg.body),
  });
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  const text = await res.text();
  const status = text.match(/statuscode=(\w+)/)?.[1];
  const point = text.match(/AccountPoint=(\d+)/)?.[1];
  // 錯誤訊息只記錄三竹的回應內容（不含帳號密碼）
  if (!res.ok || !status || !MITAKE_OK.includes(status)) {
    throw new Error(`三竹簡訊發送失敗（HTTP ${res.status}，statuscode=${status ?? '無'}）：${text.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  return { accountPoint: point ? Number(point) : undefined };
}

// 後台「發測試簡訊」：不論 SMS_MODE，直接發一則（會扣點數）
export async function sendTestSms(env: Env, phone: string): Promise<{ accountPoint?: number }> {
  return sendSmsLive(env, { channel: 'sms', recipient: phone, body: `【故事講堂】簡訊測試 ${formatTw(nowIso())}，收到代表串接成功。` });
}

// ---- 通知內容 ----
const money = (n: number) => `NT$ ${n.toLocaleString('en-US')}`;
const courseLabel = (r: Registration) => `${r.course_title}｜${r.session_name}`;

// 報名資料表（沿用舊站通知信的欄位順序）；session 為報名當下的時段與課程資訊
function registrationRows(r: Registration, session?: Session): EmailContent['rows'] {
  return [
    ['課程類別', session?.category],
    ['課程主題', r.course_title],
    ['報名時段', r.session_name],
    ['學生姓名', r.student_name],
    ['預約費用', money(r.amount)],
    ['費用說明', session?.fee_note],
    ['上課週期', session?.schedule],
    ['上課期間', session?.time],
    ['上課地點', session?.location],
    ['報名編號', String(r.id)],
  ];
}

function paymentSection(r: Registration) {
  return {
    title: '繳款資訊',
    lines: [
      '銀行代碼：812 台新銀行',
      `繳款帳號：${r.va_account}`,
      `繳款金額：${money(r.amount)}`,
      `繳費期限：${formatTw(r.va_expires_at)}`,
      '＊此為虛擬帳號，僅保留三天，請於期限內將款項轉入此繳款帳號（ATM、網路銀行、臨櫃皆可），逾期帳號會自動關閉，名額將釋出。',
      '＊繳費完成後，系統會以 Email 與簡訊通知您。',
    ],
  };
}

function email(env: Env, recipient: string, subject: string, content: EmailContent): Message {
  return { channel: 'email', recipient, subject, body: renderEmailText(env, content), html: renderEmailHtml(env, content) };
}

const greeting = (r: Registration) => `親愛的 ${r.parent_name} 先生/小姐，您好：`;

// 報名完成：寄給家長（Email + 簡訊）並通知公司信箱
export async function notifyRegistered(env: Env, r: Registration, waitlistPosition: number | null, session?: Session): Promise<void> {
  const course = courseLabel(r);

  if (r.admission === '正取') {
    await deliver(
      env,
      r.id,
      email(env, r.email, '故事講堂 - 完成報名通知信', {
        greeting: greeting(r),
        intro: '感謝您使用故事講堂網路報名服務，以下附上您的報名與轉帳資訊。',
        rows: registrationRows(r, session),
        sections: [paymentSection(r)],
      }),
    );
    await deliver(env, r.id, {
      channel: 'sms',
      recipient: r.phone,
      body: `【故事講堂】${r.student_name}已完成報名「${course}」。請於${formatTw(r.va_expires_at)}前轉帳${money(r.amount)}至台新(812)${r.va_account}，逾期名額將釋出。`,
    });
  } else {
    await deliver(
      env,
      r.id,
      email(env, r.email, '故事講堂 - 候補登記通知信', {
        greeting: greeting(r),
        intro: `感謝您使用故事講堂網路報名服務。目前名額已滿，${r.student_name} 已登記為候補第 ${waitlistPosition ?? '-'} 位。`,
        rows: registrationRows(r, session),
        sections: [{ title: '候補說明', lines: ['如有名額釋出，我們將主動與您聯繫，屆時再提供繳款帳號。', '＊候補期間不需繳費。'] }],
      }),
    );
    await deliver(env, r.id, {
      channel: 'sms',
      recipient: r.phone,
      body: `【故事講堂】「${course}」名額已滿，${r.student_name}已登記候補第${waitlistPosition ?? '-'}位，如有名額將主動聯繫您。`,
    });
  }

  // 公司信箱：新報名通知（內部使用，純文字）
  await deliver(env, r.id, {
    channel: 'email',
    recipient: env.COMPANY_EMAIL,
    subject: `【新報名】${r.admission}｜${course}｜${r.student_name}`,
    body: [
      `報名編號：${r.id}`,
      `課程時段：${course}`,
      `正取／候補：${r.admission}${r.admission === '候補' ? `（第 ${waitlistPosition ?? '-'} 位）` : ''}`,
      `學生姓名：${r.student_name}`,
      `家長姓名：${r.parent_name}`,
      `學校／年級：${r.school ?? ''} ${r.grade ?? ''}`,
      `手機：${r.phone}`,
      `Email：${r.email}`,
      `備註：${r.note ?? ''}`,
      r.va_account ? `繳費帳號：${r.va_account}（${money(r.amount)}，期限 ${formatTw(r.va_expires_at)}）` : '繳費帳號：候補不產生',
    ].join('\n'),
  });
}

// 候補遞補為正取：寄出繳費帳號
export async function notifyPromoted(env: Env, r: Registration, session?: Session): Promise<void> {
  await deliver(
    env,
    r.id,
    email(env, r.email, '故事講堂 - 候補遞補通知信', {
      greeting: greeting(r),
      intro: `「${courseLabel(r)}」有名額釋出，${r.student_name} 已由候補遞補為正取，以下附上您的報名與轉帳資訊。`,
      rows: registrationRows(r, session),
      sections: [paymentSection(r)],
    }),
  );
  await deliver(env, r.id, {
    channel: 'sms',
    recipient: r.phone,
    body: `【故事講堂】${r.student_name}已遞補「${courseLabel(r)}」正取，請於${formatTw(r.va_expires_at)}前轉帳${money(r.amount)}至台新(812)${r.va_account}。`,
  });
}

// 入帳需要人工確認（逾期入帳、金額不符、重複繳費、已取消仍入帳）：只通知公司信箱，不通知家長
export async function notifyReviewNeeded(env: Env, r: Registration): Promise<void> {
  await deliver(env, r.id, {
    channel: 'email',
    recipient: env.COMPANY_EMAIL,
    subject: `【入帳需確認】${courseLabel(r)}｜${r.student_name}`,
    body: [
      `報名編號：${r.id}`,
      `原因：${r.review_note ?? ''}`,
      `學生／家長：${r.student_name}／${r.parent_name}（${r.phone}）`,
      `應繳金額：${money(r.amount)}；累計實收：${money(r.paid_amount ?? 0)}`,
      '',
      '請到報名管理後台確認這筆報名的狀態，必要時聯繫家長或辦理退費。',
    ].join('\n'),
  });
}

// 繳費完成：收據
export async function notifyPaid(env: Env, r: Registration): Promise<void> {
  await deliver(
    env,
    r.id,
    email(env, r.email, '故事講堂 - 繳費完成通知信', {
      greeting: greeting(r),
      intro: `已收到 ${r.student_name} 的學費，報名完成！期待在課堂上見到孩子。`,
      rows: [
        ['課程主題', r.course_title],
        ['報名時段', r.session_name],
        ['學生姓名', r.student_name],
        ['繳費金額', money(r.paid_amount ?? r.amount)],
        ['入帳時間', formatTw(r.paid_at)],
        ['報名編號', String(r.id)],
      ],
      sections: [{ title: '溫馨提醒', lines: ['＊繳費憑證統一於上課日發給。'] }],
    }),
  );
  await deliver(env, r.id, {
    channel: 'sms',
    recipient: r.phone,
    body: `【故事講堂】已收到${r.student_name}「${courseLabel(r)}」學費${money(r.paid_amount ?? r.amount)}，報名完成，謝謝！`,
  });
}
