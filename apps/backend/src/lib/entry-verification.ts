import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {createMailSender} from './mailer';
import {
  buildSystemMail,
  describeLinkLifetime,
  systemMailSubject,
} from './system-mail';
import {generateToken, hashToken} from './token';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Issues a one-time email verification token for `entryId` and mails a
 * confirmation link to `email`.
 * @param env The Worker bindings.
 * @param entryId The `entries` row awaiting verification.
 * @param email The address to send the verification link to.
 * @param tournamentName The display name of the tournament being entered.
 * @param capped Whether the tournament has a capacity, i.e. whether the
 *     entry could end up waitlisted.
 */
export async function sendVerificationEmail(
  env: Bindings,
  entryId: string,
  email: string,
  tournamentName: string,
  capped: boolean,
): Promise<void> {
  const db = createDbClient(env);
  const token = generateToken();
  const {error} = await db.from('email_verification_tokens').insert({
    entry_id: entryId,
    token_hash: await hashToken(token),
    expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
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
      '下のリンクを開いて、エントリーを確定してください。' +
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
      `${describeLinkLifetime(TOKEN_TTL_MS)}期限が切れた場合は、エントリーフォームからもう一度エントリーしてください。`,
      'このエントリーに心当たりがない場合は、このメールを破棄してください。リンクを開かない限り、エントリーは確定しません。',
    ]),
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
