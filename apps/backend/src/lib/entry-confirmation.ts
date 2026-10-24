import type {TournamentType} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {hashToken} from './token';

/**
 * `invalid_token` is the participant's problem -- the token is unknown,
 * expired, already used, or its entry is no longer awaiting verification --
 * and is the only failure the caller may present as "this link is no longer
 * valid". `internal` is everything else (a Supabase outage, a timeout, a
 * malformed response): the token may well still be good, so the caller must
 * report a server fault instead, or the participant is told to enter again
 * while their entry sits in `pending_verification` and a re-entry is refused
 * as a duplicate.
 */
type ConfirmFailureReason = 'invalid_token' | 'internal';

/**
 * The tournament a confirmed entry belongs to, as the public list page's
 * URL names it, so the frontend can drop that list from its cache (#125).
 */
interface ConfirmedTournament {
  regionSlug: string;
  type: TournamentType;
}

type ConfirmResult =
  | {
      ok: true;
      status: 'confirmed' | 'waitlisted';
      tournament: ConfirmedTournament | null;
    }
  | {ok: false; reason: ConfirmFailureReason; error: string};

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

  const tokenHash = await hashToken(token);
  const {data, error} = await db.rpc('confirm_entry_by_token', {
    p_token_hash: tokenHash,
  });
  if (error) {
    if (error.code === INVALID_TOKEN_SQLSTATE) {
      return {
        ok: false,
        reason: 'invalid_token',
        error: 'invalid or expired token',
      };
    }
    return {ok: false, reason: 'internal', error: error.message};
  }

  return {
    ok: true,
    status: data as 'confirmed' | 'waitlisted',
    tournament: await readConfirmedTournament(env, tokenHash),
  };
}

/** Shape of the token row as selected by `readConfirmedTournament`. */
interface ConfirmedTournamentRow {
  entries: {tournaments: {type: TournamentType; regions: {slug: string}}};
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
): Promise<ConfirmedTournament | null> {
  const {data, error} = await createDbClient(env)
    .from('email_verification_tokens')
    .select('entries(tournaments(type, regions(slug)))')
    .eq('token_hash', tokenHash)
    .maybeSingle<ConfirmedTournamentRow>();
  if (error || !data) {
    return null;
  }
  return {
    regionSlug: data.entries.tournaments.regions.slug,
    type: data.entries.tournaments.type,
  };
}
