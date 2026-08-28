import type {StaffPasswordResetConfirmInput} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {createMailSender} from './mailer';
import {hashPassword} from './password';
import {generateToken, hashToken} from './token';

// Longer than the participant reset link's hour. A staff link is normally an
// invitation the recipient did not ask for and is not sitting waiting for, so
// an hour would mean most of them expire before they are read and every new
// account needs a second round trip through the general staff. It is still an
// account takeover if intercepted, hence a day rather than a week — and a
// general staff member can re-issue one at any time, which burns the old link
// along with it.
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The SQLSTATE `reset_staff_password` (defined by
 * `supabase/migrations/0015_staff_accounts_scope_and_password_reset.sql`)
 * raises when the token is unknown, already used, or expired.
 */
const INVALID_TOKEN_SQLSTATE = 'P0003';

/**
 * The outcome of issuing a link. A failure carries the underlying message for
 * the caller's log, never for the response body.
 */
export type StaffPasswordLinkResult = {ok: true} | {ok: false; error: string};

export type StaffPasswordResetResult =
  {ok: true} | {ok: false; status: 400 | 500; error: string};

interface ResetTokenRow {
  id: string;
}

/**
 * Issues a one-time password link for a staff account and mails it to that
 * account's address.
 *
 * Unlike the participant flow, the outcome is reported back rather than
 * swallowed: this is only reachable by an authenticated general staff member
 * acting on an account they just named, so there is no address to enumerate
 * and nothing to hide — while "the invite never went out" is precisely what
 * that staff member needs to know, since the account is unusable until its
 * owner follows the link.
 * @param env The Worker bindings.
 * @param staffAccountId The account the link sets the password for.
 * @param email The address to mail it to, i.e. that account's own.
 */
export async function sendStaffPasswordLink(
  env: Bindings,
  staffAccountId: string,
  email: string,
): Promise<StaffPasswordLinkResult> {
  const db = createDbClient(env);

  // Every link this account already has is dropped before the new one is
  // written, expired or not. `reset_staff_password` only burns an account's
  // other links once one of them has been *redeemed*, so without this an
  // invite sent to a mistyped address would stay usable for the rest of its
  // day-long TTL even after the general staff member noticed and re-issued
  // it to the right one -- and whoever holds the wrong link could redeem it
  // first and take the account over. Clearing the whole account's rows also
  // covers the pruning the expiry-only delete used to do, and this endpoint
  // is general-staff-only, so the table can't be grown by an anonymous loop
  // in the first place.
  const {error: deleteError} = await db
    .from('staff_password_reset_tokens')
    .delete()
    .eq('staff_account_id', staffAccountId);
  if (deleteError) {
    // Fail closed rather than mail a second live link: leaving two of them
    // outstanding at once is exactly what this delete exists to prevent.
    return {ok: false, error: deleteError.message};
  }

  const token = generateToken();
  const {error: insertError} = await db
    .from('staff_password_reset_tokens')
    .insert({
      staff_account_id: staffAccountId,
      token_hash: await hashToken(token),
      expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    });
  if (insertError) {
    // Don't mail a link whose token was never persisted: the recipient would
    // click through to a token that can never be found.
    return {ok: false, error: insertError.message};
  }

  const mailer = createMailSender(env);
  try {
    await mailer.send({
      to: email,
      subject: 'スタッフアカウントのパスワード設定',
      html: `<a href="${env.FRONTEND_URL}/staff/password-reset?token=${token}">こちらをクリックしてパスワードを設定してください</a>`,
    });
  } catch (mailError) {
    // The token stays in place rather than being deleted: it is unguessable
    // and expires on its own, and the general staff member can re-send the
    // invite once the mail provider is back.
    return {
      ok: false,
      error: mailError instanceof Error ? mailError.message : String(mailError),
    };
  }
  return {ok: true};
}

/**
 * Sets the password a staff member chose from their invite (or reset) link
 * and burns the link, along with every other one outstanding for the same
 * account.
 *
 * The token check, the password update and that burning all happen inside
 * `reset_staff_password`, so they commit or roll back together and two links
 * for the same account can't be redeemed at once; see the migration for the
 * locking order.
 * @param env The Worker bindings.
 * @param input The validated raw token and the password to set.
 */
export async function confirmStaffPasswordReset(
  env: Bindings,
  input: StaffPasswordResetConfirmInput,
): Promise<StaffPasswordResetResult> {
  const db = createDbClient(env);
  const tokenHash = await hashToken(input.token);

  // A cheap look at the token before the password is hashed: PBKDF2 is
  // deliberately expensive (see `./password`), and hashing up front would let
  // anyone spend that work by posting tokens that were never going to be
  // valid. Nothing is decided here — the row can still be consumed or expire
  // between this read and the call below, which is why `reset_staff_password`
  // re-checks it under the account lock.
  const {data: candidate, error} = await db
    .from('staff_password_reset_tokens')
    .select('id')
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .returns<ResetTokenRow[]>()
    .maybeSingle();
  // A failed read must not be reported as a bad token: that would tell the
  // staff member their link had expired when the database was simply down.
  if (error) {
    return {ok: false, status: 500, error: error.message};
  }
  if (!candidate) {
    return {ok: false, status: 400, error: 'invalid or expired token'};
  }

  const {error: resetError} = await db.rpc('reset_staff_password', {
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
