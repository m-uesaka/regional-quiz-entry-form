import {escapeHtml} from './html';
import {MAIL_FROM_NAME, SITE_NAME, type SendMailInput} from './mailer';

/**
 * What every system mail's subject is prefixed with, so it can be told
 * apart in an inbox at a glance (#170).
 */
const SUBJECT_PREFIX = `【${SITE_NAME}】`;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const FOOTER_NOTE =
  'このメールは送信専用のアドレスから送信しています。ご返信いただいてもお答えできません。';

/**
 * A link written out with its URL in full, not hidden behind its label: a
 * mail client that strips or disables links still leaves the URL to copy
 * (#170).
 */
export interface SystemMailLink {
  label: string;
  url: string;
}

/**
 * One block of a system mail body: a paragraph of plain text (escaped here,
 * so callers pass it raw), or a link.
 */
export type SystemMailBlock = string | SystemMailLink;

/**
 * The subject a system mail about `title` goes out under. Every system
 * mail's subject is built here, so none goes out without the prefix.
 * @param title What the mail is about.
 */
export function systemMailSubject(title: string): string {
  return `${SUBJECT_PREFIX}${title}`;
}

/**
 * How long a mailed link stays usable, in the words its mail states it in:
 * in hours when it is a whole number of them, in minutes otherwise, so a
 * lifetime that isn't never reads as 「1.5時間」. Minutes round down, so the
 * mail never promises longer than the link actually lasts.
 * @param ttlMs The link's lifetime.
 */
export function describeLinkLifetime(ttlMs: number): string {
  const lifetime =
    ttlMs % HOUR_MS === 0
      ? `${ttlMs / HOUR_MS}時間`
      : `${Math.floor(ttlMs / MINUTE_MS)}分`;
  return `このリンクの有効期限は、メールの送信から${lifetime}です。`;
}

function blockToHtml(block: SystemMailBlock): string {
  if (typeof block === 'string') {
    return `<p>${escapeHtml(block)}</p>`;
  }
  const url = escapeHtml(block.url);
  return `<p>${escapeHtml(block.label)}<br><a href="${url}">${url}</a></p>`;
}

function blockToText(block: SystemMailBlock): string {
  return typeof block === 'string' ? block : `${block.label}\n${block.url}`;
}

/**
 * Builds a system mail -- one the app sends on its own, as opposed to a
 * staff member's bulk send -- with an HTML body and a plain-text one that
 * say the same thing, both closed by the shared footer.
 * @param to The recipient.
 * @param subject The subject, as `systemMailSubject()` built it.
 * @param blocks The body, in order.
 */
export function buildSystemMail(
  to: string,
  subject: string,
  blocks: readonly SystemMailBlock[],
): SendMailInput {
  const html =
    blocks.map(blockToHtml).join('') +
    `<hr><p>${escapeHtml(MAIL_FROM_NAME)}<br>${escapeHtml(FOOTER_NOTE)}</p>`;
  const text =
    blocks.map(blockToText).join('\n\n') +
    `\n\n----\n${MAIL_FROM_NAME}\n${FOOTER_NOTE}\n`;
  return {to, subject, html, text};
}
