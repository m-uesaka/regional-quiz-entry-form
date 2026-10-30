import {afterEach, describe, expect, it, vi} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {PortalTournament} from '@regional-quiz/shared';
import {loadPortalRegions} from './portal-regions';

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: {'Content-Type': 'application/json'},
    })) as typeof fetch;
}

const TOURNAMENT: PortalTournament = {
  regionSlug: 'tokyo',
  regionName: '東京',
  regionAllowsDualEntry: false,
  tournamentType: 'saikyoi',
  tournamentName: '東京最強位',
  // Wide enough to be open whenever the test runs.
  entryOpensAt: '2000-01-01T00:00:00Z',
  entryClosesAt: '2999-12-31T00:00:00Z',
  entriesPaused: false,
  capacity: null,
  priorityRegulations: [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadPortalRegions', () => {
  it('groups the tournaments by region with their status', async () => {
    const regions = await loadPortalRegions(fakeFetch(200, [TOURNAMENT]));

    expect(regions).toEqual([
      {
        regionSlug: 'tokyo',
        regionName: '東京',
        allowsDualEntry: false,
        tournaments: [
          {
            name: '東京最強位',
            typeLabel: '最強位',
            status: 'open',
            entryPeriodLabel:
              '2000年1月1日(土) 9:00 〜 2999年12月31日(火) 9:00',
            capacityLabel: null,
            priorityNotices: [],
            entryPath: '/tokyo/saikyoi/entry',
            entryListPath: '/tokyo/saikyoi/list',
          },
        ],
      },
    ]);
  });

  it('logs the status and answers 502 when the backend cannot list the tournaments', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await expect(
      loadPortalRegions(fakeFetch(500, {error: 'boom'})),
    ).rejects.toMatchObject({status: 502} satisfies Partial<HttpError>);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('500'));
  });
});
