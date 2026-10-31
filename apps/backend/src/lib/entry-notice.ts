import type {Bindings} from '../types/env';
import {createMailSender} from './mailer';
import {
  buildSystemMail,
  systemMailSubject,
  type SystemMailBlock,
} from './system-mail';

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
  | 'pending-verification'
  | 'common-password'
  | 'dual-entry'
  | 'regulation-unavailable'
  | 'processing-failed';

/**
 * The subject the entry notice for `tournamentName` goes out under, whatever
 * the reason.
 * @param tournamentName The tournament the submission tried to enter.
 */
export function entryNoticeSubject(tournamentName: string): string {
  return systemMailSubject(
    `「${tournamentName}」へのエントリーを受け付けられませんでした`,
  );
}

/**
 * The blocks that explain each reason. Written for the owner of the
 * address, who may not be the person who submitted the form: anyone can
 * type someone else's address, which is why the closing paragraph tells
 * them they can ignore a notice they don't recognise.
 */
function reasonBlocks(
  reason: EntryNoticeReason,
  frontendUrl: string,
): SystemMailBlock[] {
  const mypageLogin = {
    label: 'マイページのログイン画面',
    url: `${frontendUrl}/mypage/login`,
  };
  switch (reason) {
    case 'password-mismatch':
      return [
        'このメールアドレスは登録済みですが、入力されたパスワードが登録済みのものと一致しませんでした。',
        'エントリーするには、マイページのログイン画面から登録済みのパスワードでログインしたうえで、エントリーフォームからもう一度エントリーしてください。',
        mypageLogin,
        'パスワードを忘れた場合は、パスワード再設定の画面から再設定できます。',
        {label: 'パスワード再設定', url: `${frontendUrl}/password-reset`},
      ];
    case 'other-region':
      return [
        'このメールアドレスでは、別の地域の大会にエントリーしています。地域をまたいで大会にエントリーすることはできません。',
        'この大会にエントリーするには、マイページのログイン画面からログインして別の地域の大会のエントリーをキャンセルしたうえで、もう一度エントリーしてください。',
        mypageLogin,
      ];
    case 'already-entered':
      return [
        'このメールアドレスでは、この大会に既にエントリー済みです。',
        'エントリーの内容は、マイページのログイン画面からログインして確認できます。',
        mypageLogin,
      ];
    case 'pending-verification':
      return [
        'このメールアドレスでは、この大会へのエントリーを受け付け済みですが、まだ確定していません。',
        '先にお送りした確認メールのリンクを開いて、エントリーを確定してください。リンクの有効期限が切れた後は、エントリーフォームからもう一度エントリーできます。',
        '確認メールが見当たらない場合は、マイページのログイン画面からログインしてこのエントリーをキャンセルしたうえで、もう一度エントリーしてください。',
        mypageLogin,
      ];
    case 'common-password':
      return [
        '入力されたパスワードは、よく使われているもののため登録できませんでした。',
        '推測されにくい別のパスワード(8文字以上)で、エントリーフォームからもう一度エントリーしてください。',
      ];
    case 'dual-entry':
      return [
        'この地域では、最強位と新人王のどちらか一方にのみエントリーできます。このメールアドレスでは、既にもう一方の大会にエントリーしています。',
        'エントリーの内容は、マイページのログイン画面からログインして確認できます。',
        mypageLogin,
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
  await createMailSender(env).send(
    buildSystemMail(email, entryNoticeSubject(tournamentName), [
      `「${tournamentName}」へのエントリーを受け付けられませんでした。`,
      ...reasonBlocks(reason, env.FRONTEND_URL),
      'このエントリーに心当たりがない場合は、このメールを破棄してください。',
    ]),
  );
}
