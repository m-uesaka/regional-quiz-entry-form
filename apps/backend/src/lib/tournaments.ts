import {
  defaultTournamentName,
  TournamentSchema,
  type Tournament,
  type TournamentType,
} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {internalError} from './errors';

/** Shape of a `tournaments` row as returned by Supabase (snake_case). */
export interface TournamentRow {
  id: string;
  region_id: string;
  type: TournamentType;
  /** What staff typed in 大会名, or null when they left it blank (0024). */
  name: string | null;
  capacity: number | null;
  entry_opens_at: string;
  entry_closes_at: string;
  // A to-one embed on a not-null foreign key, so always the region itself.
  // Read for its name, which a blank 大会名 is made from.
  regions: {name: string};
}

/** The columns of `tournaments` itself that `TournamentRow` carries. */
const TOURNAMENT_OWN_COLUMNS =
  'id, region_id, type, name, capacity, entry_opens_at, entry_closes_at';

/**
 * The select that reads a `TournamentRow`, for every read of one -- and for
 * the rows an insert or update hands back.
 */
export const TOURNAMENT_COLUMNS = `${TOURNAMENT_OWN_COLUMNS}, regions(name)`;

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
  });
}

/**
 * Thrown when Supabase itself failed, as opposed to answering that there is
 * no such tournament. The two are told apart by the callers — a missing
 * tournament is a 404, an unreachable database a 500 — and a thrown error
 * is what lets a resolver keep the plain `TournamentRow | null` return type
 * the entry-period middleware expects.
 */
export class TournamentLookupError extends Error {
  constructor(readonly cause: unknown) {
    super('failed to read the tournament');
    this.name = 'TournamentLookupError';
  }
}

/**
 * Logs a failed tournament read and returns the body to answer it with.
 *
 * Shared by every caller of the lookups below, so the log line is the same
 * whichever route or guard hit the outage, and a `TournamentLookupError` is
 * unwrapped to the Supabase error it carries.
 * @param e What the lookup threw.
 */
export function tournamentLookupFailure(e: unknown): {error: string} {
  const cause = e instanceof TournamentLookupError ? e.cause : e;
  return internalError('failed to read the tournament', cause);
}

/**
 * Reads one tournament by its primary key.
 * @param env The Worker bindings.
 * @param tournamentId The tournament's UUID.
 * @return The row, or `null` if no tournament has that id.
 */
export async function fetchTournamentById(
  env: Bindings,
  tournamentId: string,
): Promise<TournamentRow | null> {
  const db = createDbClient(env);
  const {data, error} = await db
    .from('tournaments')
    .select(TOURNAMENT_COLUMNS)
    .eq('id', tournamentId)
    .returns<TournamentRow[]>()
    .maybeSingle();
  if (error) {
    throw new TournamentLookupError(error);
  }
  return data;
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
 * @param env The Worker bindings.
 * @param regionSlug The region's slug.
 * @param tournamentSlug The tournament's type.
 * @return The row, or `null` if either the region or the tournament is
 *     missing — the caller cannot act on which of the two it was.
 */
export async function fetchTournamentBySlug(
  env: Bindings,
  regionSlug: string,
  tournamentSlug: string,
): Promise<TournamentRow | null> {
  const db = createDbClient(env);
  const {data, error} = await db
    .from('tournaments')
    .select(`${TOURNAMENT_OWN_COLUMNS}, regions!inner(name)`)
    .eq('regions.slug', regionSlug)
    .eq('type', tournamentSlug)
    .returns<TournamentRow[]>()
    .maybeSingle();
  if (error) {
    throw new TournamentLookupError(error);
  }
  return data;
}
