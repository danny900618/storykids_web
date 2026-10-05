// 通知信 HTML 版型（沿用舊站「完成報名通知信」的樣式：橘色 Logo 頁首、資料表、繳款資訊、防詐騙提醒）
// Email 不支援外部 CSS，樣式一律寫在 style 屬性；排版用 table 才能在各家信箱正常顯示
import type { Env } from './env';

export interface EmailSection {
  title: string;
  // 每一行為純文字（會自動跳脫）；以「＊」開頭的行顯示為灰色備註
  lines: string[];
}

export interface EmailContent {
  greeting: string; // 例如「親愛的 王大明 先生/小姐，您好：」
  intro: string;
  rows: [label: string, value: string | null | undefined][]; // 值為空的列不顯示
  sections?: EmailSection[];
}

const ORANGE = '#f5a33a';
const ORANGE_TEXT = '#e07b00';

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const multiline = (s: string) => escapeHtml(s).replace(/\n/g, '<br>');

function siteUrl(env: Env): string {
  return (env.PUBLIC_SITE_URL || 'https://storykids.com.tw').replace(/\/$/, '');
}

const footerNote = (env: Env) =>
  `提醒您，因詐騙集團猖獗，若有其他問題請撥打至故事講堂${env.CONTACT_PHONE ? `（${env.CONTACT_PHONE}）` : ''}聯繫，並於電話中詢問確認，謝謝。`;

export function renderEmailHtml(env: Env, c: EmailContent): string {
  const site = siteUrl(env);
  const rows = c.rows
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(
      ([label, value]) => `<tr>
        <td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}：</td>
        <td style="padding:6px 0;color:#333;line-height:1.7;">${multiline(String(value))}</td>
      </tr>`,
    )
    .join('');
  const sections = (c.sections ?? [])
    .map(
      (s) => `<tr><td style="padding:20px 32px 0;">
        <div style="border-top:1px solid ${ORANGE};padding-top:18px;">
          <p style="margin:0 0 8px;font-size:17px;font-weight:bold;color:${ORANGE_TEXT};">${escapeHtml(s.title)}</p>
          ${s.lines
            .map((line) =>
              line.startsWith('＊')
                ? `<p style="margin:4px 0;font-size:13px;color:#888;line-height:1.7;">${escapeHtml(line)}</p>`
                : `<p style="margin:4px 0;font-size:14px;color:#333;line-height:1.7;">${escapeHtml(line)}</p>`,
            )
            .join('')}
        </div>
      </td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#f4f4f4;font-family:'PingFang TC','Microsoft JhengHei','Noto Sans TC',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;">
    <tr><td style="background:${ORANGE};padding:20px 32px;">
      <img src="${site}/images/old/logo2.png" alt="故事講堂" width="150" style="display:block;border:0;max-width:150px;height:auto;">
    </td></tr>
    <tr><td style="padding:28px 32px 0;font-size:15px;color:#333;line-height:1.8;">
      <p style="margin:0;">${escapeHtml(c.greeting)}</p>
      <p style="margin:4px 0 0;">${multiline(c.intro)}</p>
    </td></tr>
    ${
      rows
        ? `<tr><td style="padding:20px 32px 0;"><div style="border-top:1px solid ${ORANGE};padding-top:14px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;width:100%;">${rows}</table></div></td></tr>`
        : ''
    }
    ${sections}
    <tr><td style="padding:20px 32px 0;">
      <div style="border-top:1px solid #ddd;padding-top:16px;font-size:13px;color:#666;line-height:1.8;">${escapeHtml(footerNote(env))}</div>
    </td></tr>
    <tr><td style="padding:20px 32px 24px;text-align:center;font-size:12px;color:#999;">
      <a href="${site}/" style="color:#999;">${escapeHtml(site.replace(/^https?:\/\//, ''))}</a>　故事講堂
    </td></tr>
  </table>
</body></html>`;
}

// 純文字版（不支援 HTML 的信箱、通知紀錄、簡訊以外的備份）
export function renderEmailText(env: Env, c: EmailContent): string {
  const rows = c.rows.filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '').map(([l, v]) => `${l}：${v}`);
  const sections = (c.sections ?? []).flatMap((s) => ['', `【${s.title}】`, ...s.lines]);
  return [c.greeting, c.intro, '', ...rows, ...sections, '', footerNote(env), '', `故事講堂 ${siteUrl(env)}/`].join('\n');
}
