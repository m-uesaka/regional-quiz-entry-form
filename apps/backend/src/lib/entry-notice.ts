import type {Bindings} from '../types/env';
import {createMailSender} from './mailer';

/**
 * Why an unauthenticated entry submission was not entered. Only the owner
 * of the address hears it, by mail (#117): all but the last concern the
 * address's own account, and `processing-failed` is a failure on our side
 * that the submitter would otherwise never learn of, having been told a
 * mail was on its way.
 */
export type EntryNoticeReason =
  | 'password-mismatch'
  | 'other-region'
  | 'already-entered'
  | 'dual-entry'
  | 'regulation-unavailable'
  | 'processing-failed';

/** The subject every entry notice is sent under. */
export const ENTRY_NOTICE_SUBJECT = 'エントリーを受け付けられませんでした';

/**
 * Escapes text for an HTML body. The tournament name is set by staff, not
 * by whoever submitted the form, but it is still text, not markup.
 */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * The paragraphs that explain each reason. Written for the owner of the
 * address, who may not be the person who submitted the form: anyone can
 * type someone else's address, which is why the closing paragraph tells
 * them they can ignore a notice they don't recognise.
 */
function reasonParagraphs(
  reason: EntryNoticeReason,
  frontendUrl: string,
): string[] {
  const mypageLogin = `<a href="${frontendUrl}/mypage/login">マイページのログイン画面</a>`;
  switch (reason) {
    case 'password-mismatch':
      return [
        'このメールアドレスは登録済みですが、入力されたパスワードが登録済みのものと一致しませんでした。',
        `エントリーするには、${mypageLogin}から登録済みのパスワードでログインしたうえで、エントリーフォームからもう一度エントリーしてください。`,
        `パスワードを忘れた場合は、<a href="${frontendUrl}/password-reset">パスワード再設定</a>から再設定できます。`,
      ];
    case 'other-region':
      return [
        'このメールアドレスは別の地域の大会で登録済みです。地域をまたいで大会にエントリーすることはできません。',
      ];
    case 'already-entered':
      return [
        'このメールアドレスでは、この大会に既にエントリー済みです。',
        `エントリーの内容は、${mypageLogin}からログインして確認できます。`,
      ];
    case 'dual-entry':
      return [
        'この地域では、最強位と新人王のどちらか一方にのみエントリーできます。このメールアドレスでは、既にもう一方の大会にエントリーしています。',
        `エントリーの内容は、${mypageLogin}からログインして確認できます。`,
      ];
    case 'regulation-unavailable':
      return [
        'エントリーフォームを開いている間に、選択したレギュレーションが変更されました。',
        'お手数ですが、エントリーフォームを開き直して、もう一度エントリーしてください。',
      ];
    case 'processing-failed':
      return [
        'エントリーの処理中にエラーが発生したため、エントリーを完了できませんでした。',
        'お手数ですが、時間をおいて、もう一度エントリーしてください。',
      ];
  }
}

/**
 * Tells the owner of `email` why an entry submitted under their address was
 * not entered. The entry form showed the submitter the same "check your
 * mail" notice it shows for a successful entry, so this is the only place
 * the reason is given.
 * @param env The Worker bindings.
 * @param email The address the submission was made under.
 * @param tournamentName The tournament it tried to enter.
 * @param reason Why it wasn't entered.
 */
export async function sendEntryNoticeEmail(
  env: Bindings,
  email: string,
  tournamentName: string,
  reason: EntryNoticeReason,
): Promise<void> {
  const paragraphs = [
    `「${escapeHtml(tournamentName)}」へのエントリーを受け付けられませんでした。`,
    ...reasonParagraphs(reason, env.FRONTEND_URL),
    'このエントリーに心当たりがない場合は、このメールを破棄してください。',
  ];
  await createMailSender(env).send({
    to: email,
    subject: ENTRY_NOTICE_SUBJECT,
    html: paragraphs.map(paragraph => `<p>${paragraph}</p>`).join(''),
  });
}
