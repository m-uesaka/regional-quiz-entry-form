import {
  defaultTournamentName,
  TournamentSchema,
  type Tournament,
  type TournamentType,
} from '@regional-quiz/shared';
import {type DbClient, type Tables} from './db';
import {unwrap} from './errors';

/**
 * Shape of a `tournaments` row as returned by Supabase (snake_case). `name`
 * is what staff typed in 大会名, or null when they left it blank (0024).
 */
export interface TournamentRow extends Pick<
  Tables<'tournaments'>,
  | 'id'
  | 'region_id'
  | 'type'
  | 'name'
  | 'capacity'
  | 'entry_opens_at'
  | 'entry_closes_at'
  | 'entries_paused'
  | 'question_set'
> {
  // A to-one embed on a not-null foreign key, so always the region itself.
  // Read for its name, which a blank 大会名 is made from.
  regions: Pick<Tables<'regions'>, 'name'>;
}

/**
 * The columns of `tournaments` itself that `TournamentRow` carries. Kept a
 * string literal type (as are the selects built from it below) so the
 * Supabase client can infer the rows they read.
 */
const TOURNAMENT_OWN_COLUMNS =
  'id, region_id, type, name, capacity, entry_opens_at, entry_closes_at, entries_paused, question_set';

/**
 * The select that reads a `TournamentRow`, for every read of one -- and for
 * the rows an insert or update hands back.
 */
export const TOURNAMENT_COLUMNS =
  `${TOURNAMENT_OWN_COLUMNS}, regions(name)` as const;

/**
 * The name a tournament is shown under: what staff typed in 大会名, or
 * `defaultTournamentName()` when they left it blank.
 *
 * Worked out on every read rather than stored (0024), so a blank-named
 * tournament follows its region's current name and its own current type.
 * @param name The stored `tournaments.name`.
 * @param regionName The name of the region the tournament is in.
 * @param type The tournament's type.
 */
export function tournamentDisplayName(
  name: string | null,
  regionName: string,
  type: TournamentType,
): string {
  return name ?? defaultTournamentName(regionName, type);
}

/** Turns a row into the camelCase shape the API answers with. */
export function rowToTournament(row: TournamentRow): Tournament {
  return TournamentSchema.parse({
    id: row.id,
    regionId: row.region_id,
    type: row.type,
    name: tournamentDisplayName(row.name, row.regions.name, row.type),
    capacity: row.capacity,
    entryOpensAt: row.entry_opens_at,
    entryClosesAt: row.entry_closes_at,
    entriesPaused: row.entries_paused,
    questionSet: row.question_set,
  });
}

/**
 * Reads one tournament by its primary key.
 *
 * A failure of Supabase itself, as opposed to its answering that there is no
 * such tournament, is thrown (`unwrap()`): a missing tournament is a 404 the
 * caller answers, an unreachable database a 500 `app.onError` answers.
 * @param db The database client.
 * @param tournamentId The tournament's UUID.
 * @return The row, or `null` if no tournament has that id.
 */
export async function fetchTournamentById(
  db: DbClient,
  tournamentId: string,
): Promise<TournamentRow | null> {
  return unwrap(
    await db
      .from('tournaments')
      .select(TOURNAMENT_COLUMNS)
      .eq('id', tournamentId)
      .maybeSingle(),
    'failed to read the tournament',
  );
}

/**
 * Reads one tournament by the pair the public URLs name it with: its
 * region's slug and its own type.
 *
 * One round trip (#123): almost every page's `load` starts here, so the
 * old two-step read -- the region's id from `regions`, then the tournament
 * -- cost every screen an extra round trip. `regions!inner` makes the embed
 * an inner join, so a missing region comes back as no row at all, the same
 * answer as a missing tournament. The embed is the same `regions(name)` every
 * `TournamentRow` carries, made inner so it can also be filtered on.
 * @param db The database client.
 * @param regionSlug The region's slug.
 * @param tournamentSlug The tournament's type.
 * @return The row, or `null` if either the region or the tournament is
 *     missing — the caller cannot act on which of the two it was.
 */
export async function fetchTournamentBySlug(
  db: DbClient,
  regionSlug: string,
  tournamentSlug: TournamentType,
): Promise<TournamentRow | null> {
  return unwrap(
    await db
      .from('tournaments')
      .select(`${TOURNAMENT_OWN_COLUMNS}, regions!inner(name)` as const)
      .eq('regions.slug', regionSlug)
      .eq('type', tournamentSlug)
      .maybeSingle(),
    'failed to read the tournament',
  );
}
