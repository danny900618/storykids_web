// 通知：Email 與簡訊
// 目前只有測試模式（MAIL_MODE / SMS_MODE = mock）：內容寫進 notifications 資料表，可在後台查看，不會真的寄出。
// 之後串接：Email → Brevo 等寄信服務；簡訊 → 三竹簡訊。只要實作 sendEmailLive / sendSmsLive 即可。
import type { Env, Registration } from './env';
import { formatTw, nowIso } from './env';

interface Message {
  channel: 'email' | 'sms';
  recipient: string;
  subject?: string;
  body: string;
}

async function deliver(env: Env, registrationId: number, msg: Message): Promise<void> {
  const mode = msg.channel === 'email' ? env.MAIL_MODE : env.SMS_MODE;
  let result = 'mock';
  if (mode === 'live') {
    try {
      if (msg.channel === 'email') await sendEmailLive(env, msg);
      else await sendSmsLive(env, msg);
      result = 'sent';
    } catch (err) {
      console.error('通知寄送失敗', err);
      result = 'failed';
    }
  }
  await env.DB.prepare(
    `INSERT INTO notifications (registration_id, channel, recipient, subject, body, result, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(registrationId, msg.channel, msg.recipient, msg.subject ?? null, msg.body, result, nowIso())
    .run();
}

// TODO：拿到寄信服務帳號後實作（寄件人 env.MAIL_FROM）
async function sendEmailLive(_env: Env, _msg: Message): Promise<void> {
  throw new Error('Email 正式寄送尚未串接');
}

// TODO：拿到三竹簡訊 API 帳號後實作
async function sendSmsLive(_env: Env, _msg: Message): Promise<void> {
  throw new Error('三竹簡訊尚未串接');
}

const money = (n: number) => `NT$ ${n.toLocaleString('en-US')}`;

// 報名完成：寄給家長（Email + 簡訊）並通知公司信箱
export async function notifyRegistered(env: Env, r: Registration, waitlistPosition: number | null): Promise<void> {
  const course = `${r.course_title}｜${r.session_name}`;

  if (r.admission === '正取') {
    await deliver(env, r.id, {
      channel: 'email',
      recipient: r.email,
      subject: `【故事講堂】報名成功通知－${course}`,
      body: [
        `${r.parent_name} 家長您好：`,
        '',
        `感謝您為 ${r.student_name} 報名故事講堂課程，以下是報名資訊：`,
        '',
        `課程：${course}`,
        `報名編號：${r.id}`,
        `學費：${money(r.amount)}`,
        `繳費帳號：台新銀行（812）${r.va_account}`,
        `繳費期限：${formatTw(r.va_expires_at)}（逾期帳號失效，名額將釋出）`,
        '',
        '此帳號為您專屬的繳費帳號，可使用 ATM、網路銀行或臨櫃轉帳，請轉入正確金額。',
        '繳費完成後，系統會以簡訊與 Email 通知您。',
        '',
        '故事講堂 敬上',
      ].join('\n'),
    });
    await deliver(env, r.id, {
      channel: 'sms',
      recipient: r.phone,
      body: `【故事講堂】${r.student_name}已完成報名「${course}」。請於${formatTw(r.va_expires_at)}前轉帳${money(r.amount)}至台新(812)${r.va_account}，逾期名額將釋出。`,
    });
  } else {
    await deliver(env, r.id, {
      channel: 'email',
      recipient: r.email,
      subject: `【故事講堂】候補登記通知－${course}`,
      body: [
        `${r.parent_name} 家長您好：`,
        '',
        `感謝您為 ${r.student_name} 報名「${course}」。`,
        `目前名額已滿，您已登記為候補第 ${waitlistPosition ?? '-'} 位（報名編號：${r.id}）。`,
        '如有名額釋出，我們將主動與您聯繫，屆時再提供繳費帳號。',
        '',
        '故事講堂 敬上',
      ].join('\n'),
    });
    await deliver(env, r.id, {
      channel: 'sms',
      recipient: r.phone,
      body: `【故事講堂】「${course}」名額已滿，${r.student_name}已登記候補第${waitlistPosition ?? '-'}位，如有名額將主動聯繫您。`,
    });
  }

  // 公司信箱：新報名通知
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
export async function notifyPromoted(env: Env, r: Registration): Promise<void> {
  const course = `${r.course_title}｜${r.session_name}`;
  await deliver(env, r.id, {
    channel: 'email',
    recipient: r.email,
    subject: `【故事講堂】候補遞補成功－${course}`,
    body: [
      `${r.parent_name} 家長您好：`,
      '',
      `「${course}」有名額釋出，${r.student_name} 已由候補遞補為正取。`,
      '',
      `學費：${money(r.amount)}`,
      `繳費帳號：台新銀行（812）${r.va_account}`,
      `繳費期限：${formatTw(r.va_expires_at)}（逾期帳號失效，名額將釋出）`,
      '',
      '故事講堂 敬上',
    ].join('\n'),
  });
  await deliver(env, r.id, {
    channel: 'sms',
    recipient: r.phone,
    body: `【故事講堂】${r.student_name}已遞補「${course}」正取，請於${formatTw(r.va_expires_at)}前轉帳${money(r.amount)}至台新(812)${r.va_account}。`,
  });
}

// 繳費完成：收據
export async function notifyPaid(env: Env, r: Registration): Promise<void> {
  const course = `${r.course_title}｜${r.session_name}`;
  await deliver(env, r.id, {
    channel: 'email',
    recipient: r.email,
    subject: `【故事講堂】繳費完成通知－${course}`,
    body: [
      `${r.parent_name} 家長您好：`,
      '',
      `已收到 ${r.student_name}「${course}」的學費 ${money(r.paid_amount ?? r.amount)}，報名完成！`,
      `報名編號：${r.id}`,
      `入帳時間：${formatTw(r.paid_at)}`,
      '',
      '繳費憑證將於上課日發給，期待在課堂上見到孩子。',
      '',
      '故事講堂 敬上',
    ].join('\n'),
  });
  await deliver(env, r.id, {
    channel: 'sms',
    recipient: r.phone,
    body: `【故事講堂】已收到${r.student_name}「${course}」學費${money(r.paid_amount ?? r.amount)}，報名完成，謝謝！`,
  });
}
