import type {PasswordResetConfirmInput} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {ResendMailSender} from './mailer';
import {hashPassword} from './password';
import {generateToken, hashToken} from './token';

// Deliberately shorter than the entry verification link's 24 hours: a reset
// link is a standing takeover of the account it was mailed to, so it should
// stop working soon after the participant asked for it.
const TOKEN_TTL_MS = 60 * 60 * 1000;

type ConfirmResult = {ok: true} | {ok: false; status: 400 | 500; error: string};

interface ParticipantRow {
  id: string;
}

interface ResetTokenRow {
  participant_id: string;
}

/**
 * Issues a one-time password reset token for the participant registered
 * under `email` and mails a reset link to that address.
 *
 * Nothing about the outcome is reported back: an unregistered address, a
 * token that couldn't be persisted and a mail send that failed all resolve
 * exactly like a link that went out, so `POST
 * /auth/participant/password-reset/request` can answer identically in every
 * case instead of becoming an oracle for which emails are registered.
 * Internal failures are logged for staff instead.
 * @param env The Worker bindings.
 * @param email The address a reset link was requested for.
 */
export async function requestPasswordReset(
  env: Bindings,
  email: string,
): Promise<void> {
  const db = createDbClient(env);

  const {data: participant, error} = await db
    .from('participants')
    .select('id')
    .eq('email', email)
    .returns<ParticipantRow[]>()
    .maybeSingle();
  if (error) {
    console.error('failed to look up the participant to reset', {
      error: error.message,
    });
    return;
  }
  if (!participant) {
    return;
  }

  const token = generateToken();
  const {error: insertError} = await db.from('password_reset_tokens').insert({
    participant_id: participant.id,
    token_hash: await hashToken(token),
    expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  });
  if (insertError) {
    // Don't mail a link whose token was never persisted -- the recipient
    // would click through to a token that can never be found.
    console.error('failed to persist the password reset token', {
      participantId: participant.id,
      error: insertError.message,
    });
    return;
  }

  const mailer = new ResendMailSender(env.MAIL_API_KEY, env.MAIL_FROM_ADDRESS);
  try {
    await mailer.send({
      to: email,
      subject: 'パスワード再設定',
      html: `<a href="${env.FRONTEND_URL}/password-reset?token=${token}">こちらをクリックしてパスワードを再設定してください</a>`,
    });
  } catch (mailError) {
    // The token stays in place rather than being deleted: it is unguessable
    // and expires on its own, and a delete here could just as well fail.
    console.error('failed to send the password reset mail', {
      participantId: participant.id,
      error: mailError,
    });
  }
}

/**
 * Sets a new password for the participant a reset token was issued for and
 * burns the token.
 *
 * The token has to be unused and unexpired; every other reset link
 * outstanding for the same participant is burnt along with it.
 * @param env The Worker bindings.
 * @param input The validated raw token and the new password.
 */
export async function confirmPasswordReset(
  env: Bindings,
  input: PasswordResetConfirmInput,
): Promise<ConfirmResult> {
  const db = createDbClient(env);
  const now = new Date().toISOString();

  // Burning the token is one conditional update rather than a read followed
  // by a write: matching on `used_at is null` from inside the update is what
  // makes the token single-use even when two confirmations for it arrive at
  // once, since the second update re-evaluates the condition after the first
  // one's row lock is released and then matches nothing.
  const {data: consumed, error} = await db
    .from('password_reset_tokens')
    .update({used_at: now})
    .eq('token_hash', await hashToken(input.token))
    .is('used_at', null)
    .gt('expires_at', now)
    .select('participant_id')
    .returns<ResetTokenRow[]>()
    .maybeSingle();
  // A failed update must not be reported as a bad token: that would tell the
  // participant their link had expired when the database was simply down.
  if (error) {
    return {ok: false, status: 500, error: error.message};
  }
  if (!consumed) {
    return {ok: false, status: 400, error: 'invalid or expired token'};
  }

  // Hashed only now, after the token check: PBKDF2 is deliberately expensive
  // (see `./password`), and doing it up front would let anyone spend that
  // work by posting tokens that were never going to be valid.
  const {error: updateError} = await db
    .from('participants')
    .update({password_hash: await hashPassword(input.newPassword)})
    .eq('id', consumed.participant_id);
  if (updateError) {
    // The token is already burnt at this point, so the participant has to
    // request a new link. That's the safe direction to fail in: the opposite
    // order would leave a usable link behind after a successful reset.
    return {ok: false, status: 500, error: updateError.message};
  }

  const {error: invalidateError} = await db
    .from('password_reset_tokens')
    .update({used_at: now})
    .eq('participant_id', consumed.participant_id)
    .is('used_at', null);
  if (invalidateError) {
    // The reset itself has gone through, so this can't fail the request.
    // What's left behind is an older link that can still change this
    // password once more -- worth a log, not a rollback.
    console.error('failed to invalidate the remaining reset tokens', {
      participantId: consumed.participant_id,
      error: invalidateError.message,
    });
  }
  return {ok: true};
}
