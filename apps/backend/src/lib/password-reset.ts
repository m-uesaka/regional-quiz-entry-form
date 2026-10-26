import type {PasswordResetConfirmInput} from '@regional-quiz/shared/password-policy';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {createMailSender} from './mailer';
import {hashPassword} from './password';
import {
  buildSystemMail,
  describeLinkLifetime,
  systemMailSubject,
} from './system-mail';
import {generateToken, hashToken} from './token';

// Deliberately shorter than the entry verification link's 24 hours: a reset
// link is a standing takeover of the account it was mailed to, so it should
// stop working soon after the participant asked for it.
const TOKEN_TTL_MS = 60 * 60 * 1000;

type ConfirmResult = {ok: true} | {ok: false; status: 400 | 500; error: string};

interface ParticipantRow {
  id: string;
  email_verified_at: string | null;
}

interface ResetTokenRow {
  id: string;
}

/**
 * The SQLSTATE the `reset_participant_password` Postgres function raises
 * (currently defined by
 * `supabase/migrations/0011_participants_password_changed_at.sql`, which
 * redefines `0009_reset_participant_password_fn.sql` and
 * `0010_reset_participant_password_participant_lock.sql`) when the token is
 * unknown, already used, or expired.
 */
const INVALID_TOKEN_SQLSTATE = 'P0003';

/**
 * Issues a one-time password reset token for the participant registered
 * under `email` and mails a reset link to that address.
 *
 * Nothing about the outcome is reported back: an unregistered address, a
 * token that couldn't be persisted and a mail send that failed all resolve
 * exactly like a link that went out. Internal failures are logged for staff
 * instead.
 *
 * An identical body is not on its own enough to keep `POST
 * /auth/participant/password-reset/request` from being an oracle for which
 * emails are registered, because the work is not identical: an unregistered
 * address costs one read, a registered one additionally costs a hash, an
 * insert and a round trip to Resend, which is measurable from the outside.
 * The route therefore hands this whole function to `waitUntil()` and answers
 * before any of it runs -- so it must not be awaited on the response path.
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
    .select('id, email_verified_at')
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

  const mailer = createMailSender(env);

  if (!participant.email_verified_at) {
    // An unverified account can't be reset (`reset_participant_password()`,
    // migration 0034): a new password would still be refused at login, and
    // the region would stay whatever an unconfirmed submission chose (#189).
    // What does get it back is the entry form, so that is what the owner is
    // told. Only this address receives it, like the link it replaces.
    try {
      await mailer.send(
        buildSystemMail(email, systemMailSubject('パスワードの再設定'), [
          'パスワード再設定のお申し込みを受け付けましたが、このメールアドレスで登録されたアカウントは、まだメールアドレスの確認が済んでいないため、パスワードを再設定できません。',
          'エントリーの確認メールのリンクを開いてエントリーを確定すると、そのエントリーで設定したパスワードでログインできるようになります。リンクの期限が切れた場合や、パスワードを変えたい場合は、エントリーフォームからもう一度エントリーしてください。そのとき入力したパスワードがアカウントのパスワードになります。',
          'パスワードの再設定を申し込んだ覚えがない場合は、このメールを破棄してください。',
        ]),
      );
    } catch (mailError) {
      console.error('failed to send the unverified-account reset mail', {
        participantId: participant.id,
        error: mailError,
      });
    }
    return;
  }

  // Reset links this participant let expire are dropped as they are
  // replaced. `/request` is unauthenticated and unthrottled, so without this
  // anyone looping it against one address grows `password_reset_tokens`
  // without bound; pruning keeps a participant's rows to the handful they
  // asked for within the last `TOKEN_TTL_MS`. Expired rows are refused by
  // `reset_participant_password` anyway, so nothing usable is deleted here.
  const {error: pruneError} = await db
    .from('password_reset_tokens')
    .delete()
    .eq('participant_id', participant.id)
    .lt('expires_at', new Date().toISOString());
  if (pruneError) {
    // Housekeeping, not part of the reset: a failure here leaves rows behind
    // but must not stop the participant from getting their link.
    console.error('failed to prune expired password reset tokens', {
      participantId: participant.id,
      error: pruneError.message,
    });
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

  try {
    await mailer.send(
      buildSystemMail(email, systemMailSubject('パスワードの再設定'), [
        'パスワード再設定のお申し込みを受け付けました。下のリンクを開いて、新しいパスワードを設定してください。',
        {
          label: 'パスワードを再設定する',
          url: `${env.FRONTEND_URL}/password-reset?token=${token}`,
        },
        `${describeLinkLifetime(TOKEN_TTL_MS)}期限が切れた場合は、パスワード再設定の画面からもう一度お申し込みください。`,
        'パスワードの再設定を申し込んだ覚えがない場合は、このメールを破棄してください。リンクを開かない限り、パスワードは変更されません。',
      ]),
    );
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
 * the new password in place while an older link stays usable. That function
 * also serializes on the participant, so two confirmations presenting two
 * different links for the same participant are applied one after the other
 * and the second is refused as already used, rather than racing (see the
 * migrations for details).
 *
 * The same statement stamps `participants.password_changed_at`, which is what
 * makes a reset cut the participant's existing sessions: they are stateless
 * week-long JWTs, so `requireParticipant()` checks the value each one carries
 * against that column rather than trusting the signature alone.
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
  // `reset_participant_password` re-checks it under the participant lock.
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
