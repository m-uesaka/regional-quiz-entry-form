// Fixtures for the entry-period gate (`middleware/entry-period.ts`), which
// reads the tournament a request is about before the handler behind it
// runs. Every test of a route that gate is attached to has to answer that
// lookup, whether or not the entry period is what the test is about.
//
// Not imported by `src/index.ts`, so none of this reaches the deployed
// Worker: `wrangler deploy` bundles from that entry point outwards.

import type {TournamentRow} from '../lib/tournaments';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The region the fixtures below belong to. */
export const TEST_REGION_ID = '11111111-1111-1111-1111-111111111111';

/**
 * A `tournaments` row whose entry period is open right now.
 *
 * The window is relative to the clock rather than a pair of literal dates:
 * whether it is open is the whole point of the fixture, and a fixed date
 * stops being the answer the test wanted the moment it passes.
 * @param overrides Fields to replace, e.g. a different `region_id`.
 */
export function openEntryPeriodTournament(
  overrides: Partial<TournamentRow> = {},
): TournamentRow {
  const now = Date.now();
  return {
    id: '12345678-1234-1234-1234-123456789012',
    region_id: TEST_REGION_ID,
    type: 'saikyoi',
    name: 'テスト大会',
    capacity: null,
    entry_opens_at: new Date(now - DAY_MS).toISOString(),
    entry_closes_at: new Date(now + DAY_MS).toISOString(),
    ...overrides,
  };
}

/** The same row with an entry period that closed yesterday. */
export function closedEntryPeriodTournament(
  overrides: Partial<TournamentRow> = {},
): TournamentRow {
  const now = Date.now();
  return openEntryPeriodTournament({
    entry_opens_at: new Date(now - 2 * DAY_MS).toISOString(),
    entry_closes_at: new Date(now - DAY_MS).toISOString(),
    ...overrides,
  });
}

/**
 * Answers the region and tournament lookups the entry-period gate makes
 * with `tournament`, and everything else with `fetchImpl`.
 *
 * Both tables are answered because the gate resolves a tournament two ways:
 * straight by `:tournamentId`, and — on the public by-slug routes — via the
 * region named by `:regionSlug` first.
 *
 * @param tournament The row the lookups should find, or `null` for a
 *     tournament (and region) that doesn't exist.
 * @param fetchImpl The stub for every other Supabase call.
 */
export function tournamentAwareFetch(
  tournament: TournamentRow | null,
  fetchImpl: typeof fetch,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/rest/v1/regions')) {
      return Promise.resolve(
        Response.json(tournament ? [{id: tournament.region_id}] : []),
      );
    }
    if (url.includes('/rest/v1/tournaments')) {
      return Promise.resolve(Response.json(tournament ? [tournament] : []));
    }
    return fetchImpl(input as RequestInfo, init);
  }) as unknown as typeof fetch;
}
