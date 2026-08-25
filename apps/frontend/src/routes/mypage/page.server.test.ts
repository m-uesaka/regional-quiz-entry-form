import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {MypageEntry} from '@regional-quiz/shared';
import {load} from './+page.server';

const ENTRIES: MypageEntry[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    tournamentId: '00000000-0000-0000-0000-000000000002',
    status: 'confirmed',
    waitlistPosition: null,
    tournament: {
      name: 'テスト大会',
      type: 'saikyoi',
      regionId: '00000000-0000-0000-0000-000000000003',
      entryOpensAt: '2020-01-01T00:00:00.000Z',
      entryClosesAt: '2099-01-01T00:00:00.000Z',
    },
  },
];

/** Builds a fake `fetch` returning the given entries and status. */
function fakeFetch(options: {
  entries?: MypageEntry[];
  status?: number;
}): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(options.entries ?? []), {
      status: options.status ?? 200,
      headers: {'Content-Type': 'application/json'},
    })) as typeof fetch;
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildEvent(fetchImpl: typeof fetch): Parameters<typeof load>[0] {
  return {fetch: fetchImpl} as Parameters<typeof load>[0];
}

describe('mypage +page.server load', () => {
  it("returns the logged-in participant's entries", async () => {
    const event = buildEvent(fakeFetch({entries: ENTRIES}));

    await expect(load(event)).resolves.toEqual({entries: ENTRIES});
  });

  it('throws 401 when not logged in', async () => {
    const event = buildEvent(fakeFetch({status: 401}));

    await expect(load(event)).rejects.toMatchObject({
      status: 401,
    } satisfies Partial<HttpError>);
  });

  it('throws 502 when the entries request fails', async () => {
    const event = buildEvent(fakeFetch({status: 500}));

    await expect(load(event)).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });
});
