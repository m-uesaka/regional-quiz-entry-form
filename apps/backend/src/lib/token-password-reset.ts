import {COMMON_ERROR_CODES} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import type {LibFailure} from './errors';
import {hashPassword} from './password';
import {INVALID_TOKEN_SQLSTATE} from './pg-errors';
import {hashToken} from './token';

/**
 * Where one of the two reset flows keeps its tokens, and the Postgres
 * function that redeems one. Only the pairs that belong together are
 * allowed, so a flow can't check one table and redeem against another.
 */
export type TokenPasswordResetTarget =
  | {tokenTable: 'password_reset_tokens'; rpc: 'reset_participant_password'}
  | {tokenTable: 'staff_password_reset_tokens'; rpc: 'reset_staff_password'};

/** The raw token from the link and the password to set. */
export interface TokenPasswordResetInput {
  token: string;
  newPassword: string;
}

export type TokenPasswordResetResult = {ok: true} | LibFailure<400>;

/**
 * Sets a new password through a one-time reset token and burns the token,
 * for the participant and staff flows alike.
 *
 * The token check, the password update and burning the account's other
 * links all happen inside `target.rpc`, so they commit or roll back
 * together; that function also locks the account, so two links for it
 * can't be redeemed at once.
 * @param env The Worker bindings.
 * @param target The token table and redeeming function of the flow.
 * @param input The validated raw token and the new password.
 * @return A 400 when the token is unknown, used or expired, a 500 when the
 *     database failed.
 */
export async function confirmTokenPasswordReset(
  env: Bindings,
  target: TokenPasswordResetTarget,
  input: TokenPasswordResetInput,
): Promise<TokenPasswordResetResult> {
  const db = createDbClient(env);
  const tokenHash = await hashToken(input.token);

  // A cheap look at the token before the password is hashed: PBKDF2 is
  // deliberately expensive (see `./password`), and hashing up front would
  // let anyone spend that work by posting tokens that were never going to be
  // valid. Nothing is decided here -- the row can still be consumed or
  // expire between this read and the call below, which is why `target.rpc`
  // re-checks it under the account lock.
  const {data: candidate, error} = await db
    .from(target.tokenTable)
    .select('id')
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  // A failed read must not be reported as a bad token: that would tell the
  // user their link had expired when the database was simply down.
  if (error) {
    return {ok: false, status: 500, error: error.message};
  }
  if (!candidate) {
    return {
      ok: false,
      status: 400,
      error: COMMON_ERROR_CODES.INVALID_OR_EXPIRED_TOKEN,
    };
  }

  const {error: resetError} = await db.rpc(target.rpc, {
    p_token_hash: tokenHash,
    p_password_hash: await hashPassword(input.newPassword),
  });
  if (resetError) {
    if (resetError.code === INVALID_TOKEN_SQLSTATE) {
      return {
        ok: false,
        status: 400,
        error: COMMON_ERROR_CODES.INVALID_OR_EXPIRED_TOKEN,
      };
    }
    return {ok: false, status: 500, error: resetError.message};
  }
  return {ok: true};
}
