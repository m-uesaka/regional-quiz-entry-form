import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {Region, Tournament} from '@regional-quiz/shared';
import {fakeCookies} from '../../../test-support/fake-cookies';
import {fakeFetch} from '../../../test-support/fake-fetch';
import {load} from './+page.server';

const TOKYO: Region = {
  id: '00000000-0000-0000-0000-000000000011',
  slug: 'tokyo',
  name: '東京',
  allowsDualEntry: false,
};
const AICHI: Region = {
  id: '00000000-0000-0000-0000-000000000022',
  slug: 'aichi',
  name: '愛知',
  allowsDualEntry: false,
};

function tournament(
  id: string,
  regionId: string,
  type: Tournament['type'],
): Tournament {
  return {
    id,
    regionId,
    type,
    name: `大会${id.slice(-1)}`,
    capacity: null,
    entryOpensAt: '2026-01-01T00:00:00.000Z',
    entryClosesAt: '2026-02-01T00:00:00.000Z',
    entriesPaused: false,
  };
}

const TOURNAMENTS = [
  tournament('00000000-0000-0000-0000-000000000001', TOKYO.id, 'shinjinou'),
  tournament('00000000-0000-0000-0000-000000000002', AICHI.id, 'saikyoi'),
  tournament('00000000-0000-0000-0000-000000000003', TOKYO.id, 'saikyoi'),
];

/** What `load` returns (its generated type also admits `void`). */
interface LoadData {
  tournaments: Array<Tournament & {regionName: string}>;
  deleted: boolean;
}

function buildLoadEvent(
  fetchImpl: typeof fetch,
  search = '',
): Parameters<typeof load>[0] {
  return {
    fetch: fetchImpl,
    cookies: fakeCookies(),
    url: new URL(`http://localhost/admin/tournaments${search}`),
  } as Parameters<typeof load>[0];
}

const api = fakeFetch([
  {method: 'GET', url: /^\/api\/regions$/, body: [TOKYO, AICHI]},
  {method: 'GET', url: /^\/api\/tournaments$/, body: TOURNAMENTS},
]);

describe('admin tournament list +page.server load', () => {
  it('lists every tournament with its region, in the order the API set', async () => {
    const data = (await load(buildLoadEvent(api))) as LoadData;

    expect(
      data.tournaments.map(t => `${t.regionName} ${t.type} ${t.id.slice(-1)}`),
    ).toEqual(['東京 shinjinou 1', '愛知 saikyoi 2', '東京 saikyoi 3']);
    expect(data.deleted).toBe(false);
  });

  it('says a delete just happened when the edit screen sent it here', async () => {
    const data = (await load(buildLoadEvent(api, '?deleted'))) as LoadData;

    expect(data.deleted).toBe(true);
  });

  it('reports a failed read as a bad gateway', async () => {
    const failing = fakeFetch([
      {method: 'GET', url: '/api/regions', body: [TOKYO, AICHI]},
      {
        method: 'GET',
        url: '/api/tournaments',
        status: 500,
        body: {error: 'nope'},
      },
    ]);

    await expect(load(buildLoadEvent(failing))).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });
});
