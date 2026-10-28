import {ENTRY_VERIFICATION_TOKEN_TTL_MS} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {createMailSender} from './mailer';
import {
  buildSystemMail,
  describeLinkLifetime,
  systemMailSubject,
} from './system-mail';
import {generateToken, hashToken} from './token';

/**
 * Issues a one-time email verification token for `entryId` and mails a
 * confirmation link to `email`.
 * @param env The Worker bindings.
 * @param entryId The `entries` row awaiting verification.
 * @param email The address to send the verification link to.
 * @param tournamentName The display name of the tournament being entered.
 * @param capped Whether the tournament has a capacity, i.e. whether the
 *     entry could end up waitlisted.
 * @param withdrawnTournaments The display names of the tournaments whose
 *     pending entries this submission withdrew by taking the unverified
 *     account over (#189), or omit when it withdrew none. Empty when the
 *     names couldn't be read, which is still worth telling.
 */
export async function sendVerificationEmail(
  env: Bindings,
  entryId: string,
  email: string,
  tournamentName: string,
  capped: boolean,
  withdrawnTournaments?: readonly string[],
): Promise<void> {
  const db = createDbClient(env);
  const token = generateToken();
  const {error} = await db.from('email_verification_tokens').insert({
    entry_id: entryId,
    token_hash: await hashToken(token),
    expires_at: new Date(
      Date.now() + ENTRY_VERIFICATION_TOKEN_TTL_MS,
    ).toISOString(),
  });
  if (error) {
    // Don't send a link whose token was never persisted -- the recipient
    // would click through to a token that can never be found.
    throw new Error(`failed to persist verification token: ${error.message}`);
  }

  // The submitter's own name is left out on purpose: anyone can type
  // someone else's address into the form, and whatever they typed as their
  // name would otherwise land in the stranger's inbox under our domain.
  await createMailSender(env).send(
    buildSystemMail(email, verificationMailSubject(tournamentName), [
      `「${tournamentName}」へのエントリーを受け付けました。エントリーはまだ確定していません。`,
      // Opening the link only shows a confirm button: a mail scanner
      // fetching it must not confirm anything (#190).
      '下のリンクを開き、表示されるページのボタンを押してエントリーを確定してください。' +
        (capped
          ? '定員に達している場合は、キャンセル待ちとして受け付けます。'
          : ''),
      {
        label: 'エントリーを確定する',
        url: `${env.FRONTEND_URL}/verify?token=${token}`,
      },
      // An expired link's entry is cancelled by the next entry the
      // participant submits (`lapse_expired_pending_entries()`, #172), so
      // entering again is all it takes.
      `${describeLinkLifetime(ENTRY_VERIFICATION_TOKEN_TTL_MS)}期限が切れた場合は、エントリーフォームからもう一度エントリーしてください。`,
      ...(withdrawnTournaments ? [withdrawalNotice(withdrawnTournaments)] : []),
      'このエントリーに心当たりがない場合は、このメールを破棄してください。リンク先のページでボタンを押さない限り、エントリーは確定しません。',
    ]),
  );
}

/**
 * Tells the owner of the address which pending entries the takeover behind
 * this entry withdrew. They may have been the owner's own, made under a
 * password this submission didn't match or in another region.
 * @param tournamentNames The withdrawn tournaments' display names, or empty
 *     when they couldn't be read.
 */
function withdrawalNotice(tournamentNames: readonly string[]): string {
  const which =
    tournamentNames.length > 0
      ? tournamentNames.map(name => `「${name}」`).join('、') + 'への'
      : '';
  return (
    `このメールアドレスで受け付けていた、まだ確定していない${which}エントリーは、` +
    '異なるパスワードまたは別の地域の大会でエントリーされたため取り消しました。' +
    '取り消したエントリーの確認メールのリンクは使えません。' +
    '引き続き参加を希望する場合は、このエントリーを確定した後、エントリーフォームからもう一度エントリーしてください。'
  );
}

/**
 * The subject the verification mail for `tournamentName` goes out under.
 * @param tournamentName The display name of the tournament being entered.
 */
export function verificationMailSubject(tournamentName: string): string {
  return systemMailSubject(
    `「${tournamentName}」のエントリーを確定してください`,
  );
}
