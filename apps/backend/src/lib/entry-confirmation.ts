import {
  COMMON_ERROR_CODES,
  type EntryVerificationTournament,
} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import type {LibFailure} from './errors';
import {INVALID_TOKEN_SQLSTATE} from './pg-errors';
import {hashToken} from './token';

/**
 * The 400 is the participant's problem -- the token is unknown, expired,
 * already used, or its entry is no longer awaiting verification -- and is the
 * only failure the caller may present as "this link is no longer valid". The
 * 500 is everything else (a Supabase outage, a timeout, a malformed response):
 * the token may well still be good, so the caller must report a server fault
 * instead, or the participant is told to enter again while their entry sits
 * in `pending_verification` and a re-entry is refused as a duplicate.
 */
type ConfirmResult =
  | {
      ok: true;
      // Not `status`, which on a failure is the HTTP status.
      entryStatus: 'confirmed' | 'waitlisted';
      tournament: EntryVerificationTournament | null;
    }
  | LibFailure<400>;

/**
 * Confirms the `entries` row a verification token was issued for.
 *
 * The entry is set to `confirmed` if the tournament still has capacity and
 * nobody is on its waitlist, or `waitlisted` (at the tail, with the next
 * `waitlist_position`) otherwise: a seat that came free while others were
 * waiting is theirs, and `promote_waitlisted_entries` fills it in order
 * (#283). The token is marked used so it can't be replayed, and an entry
 * that is no longer awaiting verification -- a cancelled one, say -- is
 * refused even when the token itself is still valid.
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

  const tokenHash = await hashToken(token);
  const {data, error} = await db.rpc('confirm_entry_by_token', {
    p_token_hash: tokenHash,
  });
  if (error) {
    if (error.code === INVALID_TOKEN_SQLSTATE) {
      return {
        ok: false,
        status: 400,
        error: COMMON_ERROR_CODES.INVALID_OR_EXPIRED_TOKEN,
      };
    }
    return {ok: false, status: 500, error: error.message};
  }

  return {
    ok: true,
    entryStatus: data,
    tournament: await readConfirmedTournament(env, tokenHash),
  };
}

/**
 * Reads which tournament the just-used token's entry belongs to. The token
 * row is only marked used, not deleted, so it can still be followed after
 * the RPC. Best-effort: the entry is confirmed either way, and a list left
 * in the frontend's cache only lags by that cache's lifetime, so a failed
 * read answers `null` rather than turning a confirmation into an error.
 */
async function readConfirmedTournament(
  env: Bindings,
  tokenHash: string,
): Promise<EntryVerificationTournament | null> {
  const {data, error} = await createDbClient(env)
    .from('email_verification_tokens')
    .select('entries(tournaments(type, regions(slug)))')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  return {
    regionSlug: data.entries.tournaments.regions.slug,
    type: data.entries.tournaments.type,
  };
}
