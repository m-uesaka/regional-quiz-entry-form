import {describe, expect, it} from 'vitest';
import type {PortalTournament} from '@regional-quiz/shared';
import {load} from './+page.server';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: {'Content-Type': 'application/json'},
    })) as typeof fetch;
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildEvent(fetchImpl: typeof fetch): Parameters<typeof load>[0] {
  return {fetch: fetchImpl} as Parameters<typeof load>[0];
}

const TOURNAMENT: PortalTournament = {
  regionSlug: 'tokyo',
  regionName: '東京',
  tournamentType: 'saikyoi',
  tournamentName: '東京最強位',
  entryOpensAt: '2000-01-01T00:00:00Z',
  entryClosesAt: '2000-01-31T00:00:00Z',
};

describe('top +page.server load', () => {
  it('reads the tournaments with the links to their entry lists', async () => {
    const result = await load(buildEvent(fakeFetch(200, [TOURNAMENT])));

    expect(result?.regions).toEqual([
      expect.objectContaining({
        regionSlug: 'tokyo',
        tournaments: [
          expect.objectContaining({
            status: 'closed',
            entryListPath: '/tokyo/saikyoi/list',
          }),
        ],
      }),
    ]);
  });

  it('answers no regions rather than failing when the API errors', async () => {
    const result = await load(buildEvent(fakeFetch(500, {})));

    expect(result).toEqual({regions: null});
  });

  it('answers no regions rather than failing when the API is unreachable', async () => {
    const unreachable = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    const result = await load(buildEvent(unreachable));

    expect(result).toEqual({regions: null});
  });
});
