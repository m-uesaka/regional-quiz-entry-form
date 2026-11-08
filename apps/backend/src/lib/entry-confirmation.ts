import {
  COMMON_ERROR_CODES,
  type EntryVerificationTournament,
} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import type {LibFailure} from './errors';
import {INVALID_TOKEN_SQLSTATE} from './pg-errors';
import {hashToken} from './token';
import {promoteAfterWaitlistedConfirmation} from './waitlist';

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
 * waiting is theirs (#283). A queued entry is followed by a promotion,
 * which fills any seat that is free -- one an earlier, failed promotion
 * left empty, or every seat of a tournament without a capacity -- in queue
 * order, mailing those ahead of this entry. When the seats reach this entry
 * too, it is reported as `confirmed` and isn't mailed (see
 * `promoteAfterWaitlistedConfirmation()`). The token is marked used so it
 * can't be replayed, and an entry that is no longer awaiting verification
 * -- a cancelled one, say -- is refused even when the token itself is
 * still valid.
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

  const entry = await readConfirmedEntry(env, tokenHash);
  let entryStatus = data;
  if (entryStatus === 'waitlisted') {
    entryStatus = await promoteIfSeatsAreFree(env, entry);
  }
  return {
    ok: true,
    entryStatus,
    tournament: entry?.tournament ?? null,
  };
}

/** What `readConfirmedEntry()` reads about the just-confirmed entry. */
interface ConfirmedEntry {
  entryId: string;
  tournamentId: string;
  tournament: EntryVerificationTournament;
}

/**
 * Reads which entry, and which tournament, the just-used token belongs to.
 * The token row is only marked used, not deleted, so it can still be
 * followed after the RPC. Best-effort: the entry is confirmed either way,
 * and a list left in the frontend's cache only lags by that cache's
 * lifetime, so a failed read answers `null` rather than turning a
 * confirmation into an error. (The promotion after a queued confirmation
 * is then skipped, and caught up by the next one; see below.)
 */
async function readConfirmedEntry(
  env: Bindings,
  tokenHash: string,
): Promise<ConfirmedEntry | null> {
  const {data, error} = await createDbClient(env)
    .from('email_verification_tokens')
    .select(
      'entry_id, entries(tournament_id, tournaments(type, regions(slug)))',
    )
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  return {
    entryId: data.entry_id,
    tournamentId: data.entries.tournament_id,
    tournament: {
      regionSlug: data.entries.tournaments.regions.slug,
      type: data.entries.tournaments.type,
    },
  };
}

/**
 * Promotes into any seat that is free once the entry has been queued, and
 * answers the status the entry ends up with.
 *
 * Run after every queued confirmation rather than only when a seat looks
 * free: `promote_waitlisted_entries` counts the seats under the tournament
 * lock, and promotes nobody when there are none, for one cheap round trip.
 * A failure is logged and the entry reported as queued, which is what it
 * still is: the confirmation itself is committed, and the seat is filled in
 * order by the next promotion (the next queued confirmation, cancellation,
 * or capacity save).
 * @param env The Worker bindings.
 * @param queued The queued entry, or `null` if it couldn't be read.
 */
async function promoteIfSeatsAreFree(
  env: Bindings,
  queued: ConfirmedEntry | null,
): Promise<'confirmed' | 'waitlisted'> {
  if (!queued) {
    console.error(
      'failed to read the queued entry, so nobody was promoted after it',
    );
    return 'waitlisted';
  }
  try {
    const promoted = await promoteAfterWaitlistedConfirmation(
      env,
      queued.tournamentId,
      queued.entryId,
    );
    return promoted ? 'confirmed' : 'waitlisted';
  } catch (promotionError) {
    console.error('failed to promote after a queued confirmation', {
      tournamentId: queued.tournamentId,
      error: promotionError,
    });
    return 'waitlisted';
  }
}
