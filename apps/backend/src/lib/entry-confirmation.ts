import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {hashToken} from './token';

type ConfirmResult =
  {ok: true; status: 'confirmed' | 'waitlisted'} | {ok: false; error: string};

/**
 * The SQLSTATE the `confirm_entry_by_token` Postgres function raises (see
 * `supabase/migrations/0003_confirm_entry_by_token_fn.sql`, amended by
 * `0008_confirm_entry_by_token_entry_status.sql`) when the token is unknown,
 * expired, or already used, or when the entry it was issued for is no longer
 * awaiting verification (it was cancelled in the meantime).
 */
const INVALID_TOKEN_SQLSTATE = 'P0003';

/**
 * Confirms the `entries` row a verification token was issued for.
 *
 * The entry is set to `confirmed` if the tournament still has capacity, or
 * `waitlisted` (with the next `waitlist_position`) otherwise. The token is
 * marked used so it can't be replayed, and an entry that is no longer
 * awaiting verification -- a cancelled one, say -- is refused even when the
 * token itself is still valid.
 *
 * This delegates to the `confirm_entry_by_token` Postgres function, which
 * performs the token lookup, capacity check, and both updates inside one
 * transaction while holding row locks on the token and the tournament, so
 * concurrent confirmations for the same tournament or replays of the same
 * token can't race each other (see the migration for details).
 * @param env The Worker bindings.
 * @param token The raw token from the verification link.
 */
export async function confirmEntryByToken(
  env: Bindings,
  token: string,
): Promise<ConfirmResult> {
  const db = createDbClient(env);

  const {data, error} = await db.rpc('confirm_entry_by_token', {
    p_token_hash: await hashToken(token),
  });
  if (error) {
    if (error.code === INVALID_TOKEN_SQLSTATE) {
      return {ok: false, error: 'invalid or expired token'};
    }
    return {ok: false, error: error.message};
  }

  return {ok: true, status: data as 'confirmed' | 'waitlisted'};
}
