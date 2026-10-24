import {
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
  name: string;
  capacity: number | null;
  entry_opens_at: string;
  entry_closes_at: string;
}

/** The columns of `TournamentRow`, for every select in this file. */
const TOURNAMENT_COLUMNS =
  'id, region_id, type, name, capacity, entry_opens_at, entry_closes_at';

/** Turns a row into the camelCase shape the API answers with. */
export function rowToTournament(row: TournamentRow): Tournament {
  return TournamentSchema.parse({
    id: row.id,
    regionId: row.region_id,
    type: row.type,
    name: row.name,
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
 * answer as a missing tournament. The embed selects no columns (`()`): it is
 * only there to filter on, so the row comes back as a plain `TournamentRow`.
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
    .select(`${TOURNAMENT_COLUMNS}, regions!inner()`)
    .eq('regions.slug', regionSlug)
    .eq('type', tournamentSlug)
    .returns<TournamentRow[]>()
    .maybeSingle();
  if (error) {
    throw new TournamentLookupError(error);
  }
  return data;
}
