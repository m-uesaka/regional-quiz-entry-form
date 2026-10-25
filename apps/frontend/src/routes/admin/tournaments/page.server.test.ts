import {describe, expect, it} from 'vitest';
import type {Cookies, HttpError} from '@sveltejs/kit';
import type {Region, Tournament} from '@regional-quiz/shared';
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
  };
}

const TOURNAMENTS = [
  tournament('00000000-0000-0000-0000-000000000001', TOKYO.id, 'shinjinou'),
  tournament('00000000-0000-0000-0000-000000000002', AICHI.id, 'saikyoi'),
  tournament('00000000-0000-0000-0000-000000000003', TOKYO.id, 'saikyoi'),
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

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
    cookies: {delete: () => {}} as unknown as Cookies,
    url: new URL(`http://localhost/admin/tournaments${search}`),
  } as Parameters<typeof load>[0];
}

const fakeFetch = (async (input: RequestInfo | URL) =>
  String(input).includes('/regions')
    ? jsonResponse([TOKYO, AICHI])
    : jsonResponse(TOURNAMENTS)) as typeof fetch;

describe('admin tournament list +page.server load', () => {
  it('lists every tournament with its region, in the order the API set', async () => {
    const data = (await load(buildLoadEvent(fakeFetch))) as LoadData;

    expect(
      data.tournaments.map(t => `${t.regionName} ${t.type} ${t.id.slice(-1)}`),
    ).toEqual(['東京 shinjinou 1', '愛知 saikyoi 2', '東京 saikyoi 3']);
    expect(data.deleted).toBe(false);
  });

  it('says a delete just happened when the edit screen sent it here', async () => {
    const data = (await load(
      buildLoadEvent(fakeFetch, '?deleted'),
    )) as LoadData;

    expect(data.deleted).toBe(true);
  });

  it('reports a failed read as a bad gateway', async () => {
    const failing = (async () =>
      jsonResponse({error: 'nope'}, 500)) as unknown as typeof fetch;

    await expect(load(buildLoadEvent(failing))).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });
});
