import type {RegulationUpsert} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {
  TOURNAMENT_NOT_FOUND_SQLSTATE,
  TournamentNotFoundError,
} from './tournament-errors';

/**
 * The SQLSTATEs the `sync_regulations` Postgres function raises (defined in
 * `supabase/migrations/0014_sync_regulations_fn.sql`, redefined against the
 * `entry_regulations` join table in `0018_entry_regulations.sql`) for the
 * two failures the caller is expected to report rather than treat as a
 * server error.
 */
const UNKNOWN_REGULATION_SQLSTATE = 'P0003';
const REGULATION_IN_USE_SQLSTATE = 'P0004';

/**
 * Postgres' own `foreign_key_violation`, which the final delete in
 * `sync_regulations()` does reach. The in-use check ahead of it no longer
 * rules that out: an entry's regulations are written to `entry_regulations`
 * by a statement of their own (`replaceEntryRegulations()` in
 * `lib/entries.ts`), and that table has no foreign key to `tournaments`, so
 * the insert takes no lock on the tournament row the function holds
 * `for update`. One that commits between the check and the delete fails the
 * delete here instead — the same answer as P0004, reached a moment later,
 * which is why both are reported as "a regulation is still in use".
 */
const FOREIGN_KEY_VIOLATION_SQLSTATE = '23503';

/**
 * Thrown when a request names a regulation `id` that doesn't belong to the
 * tournament being saved — a stale staff screen, or a copied-in id from
 * another tournament. Staff-facing: the message is rendered verbatim.
 */
export class UnknownRegulationError extends Error {
  constructor(readonly ids: string) {
    super(`この大会に存在しないレギュレーションが指定されています: ${ids}`);
    this.name = 'UnknownRegulationError';
  }
}

/**
 * Thrown when the request drops a regulation that an entry still points at.
 * Nothing is written in that case — the sync runs in one transaction — so
 * the staff member can re-submit with the named regulations put back.
 */
export class RegulationInUseError extends Error {
  constructor(readonly labels: string) {
    super(
      'エントリーで使用中のため削除できないレギュレーションがあります' +
        (labels === '' ? '' : `: ${labels}`),
    );
    this.name = 'RegulationInUseError';
  }
}

/**
 * Brings a tournament's regulations in line with `regulations`, which is
 * the full set as it should look afterwards.
 *
 * This delegates to the `sync_regulations` Postgres function, which does
 * the whole diff (update by id, insert without one, delete what's gone) in
 * a single transaction with the tournament row locked, so concurrent saves
 * for the same tournament can't interleave. `display_order` is taken from
 * the array order, so the caller reorders regulations by reordering the
 * array.
 *
 * Unlike `syncFormFieldDefs()` this can't delete and re-insert: `entries`
 * references `regulations` by the composite foreign key `(regulation_id,
 * tournament_id)`, so an existing entry's regulation has to keep its id.
 * @param env The Worker bindings containing the Supabase connection info.
 * @param tournamentId The tournament whose regulations are being saved.
 * @param regulations The regulations as they should look afterwards.
 * @throws {TournamentNotFoundError} If `tournamentId` doesn't exist.
 * @throws {UnknownRegulationError} If an element names an `id` that isn't a
 *     regulation of this tournament.
 * @throws {RegulationInUseError} If a regulation missing from
 *     `regulations` is still referenced by an entry.
 */
export async function syncRegulations(
  env: Bindings,
  tournamentId: string,
  regulations: RegulationUpsert[],
): Promise<void> {
  const db = createDbClient(env);

  const {error} = await db.rpc('sync_regulations', {
    p_tournament_id: tournamentId,
    p_regulations: regulations,
  });
  if (!error) return;

  switch (error.code) {
    case TOURNAMENT_NOT_FOUND_SQLSTATE:
      throw new TournamentNotFoundError(tournamentId);
    // The offending ids/labels travel in the exception's `detail`, so the
    // staff-facing sentence is built here rather than in the database.
    case UNKNOWN_REGULATION_SQLSTATE:
      throw new UnknownRegulationError(error.details ?? '');
    case REGULATION_IN_USE_SQLSTATE:
      throw new RegulationInUseError(error.details ?? '');
    // No labels here: `details` is Postgres' own wording about the
    // constraint, which describes the database rather than anything the
    // staff member can act on.
    case FOREIGN_KEY_VIOLATION_SQLSTATE:
      throw new RegulationInUseError('');
    default:
      throw new Error(error.message);
  }
}
