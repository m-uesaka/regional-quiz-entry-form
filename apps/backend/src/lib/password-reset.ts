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
  id: string;
}

/**
 * The SQLSTATE the `reset_participant_password` Postgres function raises
 * (see `supabase/migrations/0009_reset_participant_password_fn.sql`) when
 * the token is unknown, already used, or expired.
 */
const INVALID_TOKEN_SQLSTATE = 'P0003';

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
 *
 * The token check, the password update and that burning all happen inside
 * the `reset_participant_password` Postgres function, so they commit or roll
 * back together: a failure to burn the remaining links can no longer leave
 * the new password in place while an older link stays usable (see the
 * migration for details).
 * @param env The Worker bindings.
 * @param input The validated raw token and the new password.
 */
export async function confirmPasswordReset(
  env: Bindings,
  input: PasswordResetConfirmInput,
): Promise<ConfirmResult> {
  const db = createDbClient(env);
  const tokenHash = await hashToken(input.token);

  // A cheap look at the token before the password is hashed: PBKDF2 is
  // deliberately expensive (see `./password`), and hashing up front would
  // let anyone spend that work by posting tokens that were never going to be
  // valid. Nothing is decided here -- the row can still be consumed or
  // expire between this read and the call below, which is why
  // `reset_participant_password` re-checks it under a row lock.
  const {data: candidate, error} = await db
    .from('password_reset_tokens')
    .select('id')
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .returns<ResetTokenRow[]>()
    .maybeSingle();
  // A failed read must not be reported as a bad token: that would tell the
  // participant their link had expired when the database was simply down.
  if (error) {
    return {ok: false, status: 500, error: error.message};
  }
  if (!candidate) {
    return {ok: false, status: 400, error: 'invalid or expired token'};
  }

  const {error: resetError} = await db.rpc('reset_participant_password', {
    p_token_hash: tokenHash,
    p_password_hash: await hashPassword(input.newPassword),
  });
  if (resetError) {
    if (resetError.code === INVALID_TOKEN_SQLSTATE) {
      return {ok: false, status: 400, error: 'invalid or expired token'};
    }
    return {ok: false, status: 500, error: resetError.message};
  }
  return {ok: true};
}
