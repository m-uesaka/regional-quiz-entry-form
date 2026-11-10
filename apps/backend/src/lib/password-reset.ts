import type {PasswordResetConfirmInput} from '@regional-quiz/shared/password-policy';
import type {Bindings} from '../types/env';
import type {DbClient} from './db';
import {createMailSender} from './mailer';
import {
  buildSystemMail,
  describeLinkLifetime,
  systemMailSubject,
} from './system-mail';
import {generateToken, hashToken} from './token';
import {
  confirmTokenPasswordReset,
  type TokenPasswordResetResult,
} from './token-password-reset';

// Deliberately shorter than the entry verification link's 24 hours: a reset
// link is a standing takeover of the account it was mailed to, so it should
// stop working soon after the participant asked for it.
const TOKEN_TTL_MS = 60 * 60 * 1000;

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
 * @param db The database client.
 * @param email The address a reset link was requested for.
 */
export async function requestPasswordReset(
  env: Bindings,
  db: DbClient,
  email: string,
): Promise<void> {
  const {data: participant, error} = await db
    .from('participants')
    .select('id, email_verified_at')
    .eq('email', email)
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
 * burns the token, along with every other one outstanding for the
 * participant. The token check, the update and the locking are
 * `confirmTokenPasswordReset()`'s.
 *
 * What is particular to participants: `reset_participant_password` also
 * stamps `participants.password_changed_at`, which is what makes a reset cut
 * the participant's existing sessions. They are stateless week-long JWTs, so
 * `requireParticipant()` checks the value each one carries against that
 * column rather than trusting the signature alone.
 * @param db The database client.
 * @param input The validated raw token and the new password.
 */
export async function confirmPasswordReset(
  db: DbClient,
  input: PasswordResetConfirmInput,
): Promise<TokenPasswordResetResult> {
  return confirmTokenPasswordReset(
    db,
    {tokenTable: 'password_reset_tokens', rpc: 'reset_participant_password'},
    input,
  );
}
