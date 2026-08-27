import {describe, expect, it} from 'vitest';
import type {HttpError, Redirect} from '@sveltejs/kit';
import type {MypageEntry} from '@regional-quiz/shared';
import {actions, load} from './+page.server';

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

const ENTRY_ID = ENTRIES[0].id;

/**
 * Builds the partial `RequestEvent` the `cancel` action needs, carrying the
 * given entry id as the submitted form body.
 */
function buildCancelEvent(
  fetchImpl: typeof fetch,
  entryId: string = ENTRY_ID,
): Parameters<typeof actions.cancel>[0] {
  const body = new FormData();
  body.set('entryId', entryId);
  return {
    fetch: fetchImpl,
    request: new Request('http://localhost/mypage?/cancel', {
      method: 'POST',
      body,
    }),
  } as Parameters<typeof actions.cancel>[0];
}

/** Builds a fake `fetch` answering the DELETE with the given status. */
function fakeDeleteFetch(status: number): typeof fetch {
  return (async () =>
    new Response(status === 200 ? JSON.stringify({ok: true}) : '{}', {
      status,
      headers: {'Content-Type': 'application/json'},
    })) as typeof fetch;
}

describe('mypage +page.server load', () => {
  it("returns the logged-in participant's entries", async () => {
    const event = buildEvent(fakeFetch({entries: ENTRIES}));

    await expect(load(event)).resolves.toEqual({entries: ENTRIES});
  });

  it('redirects to the login page when not logged in', async () => {
    const event = buildEvent(fakeFetch({status: 401}));

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: '/mypage/login',
    } satisfies Partial<Redirect>);
  });

  it('throws 502 when the entries request fails', async () => {
    const event = buildEvent(fakeFetch({status: 500}));

    await expect(load(event)).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });
});

describe('mypage +page.server cancel action', () => {
  it('cancels the entry the form names', async () => {
    let requested: {url: string; method?: string} | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requested = {url: String(input), method: init?.method};
      return new Response(JSON.stringify({ok: true}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      });
    }) as typeof fetch;

    await expect(
      actions.cancel(buildCancelEvent(fetchImpl)),
    ).resolves.toBeUndefined();
    expect(requested?.method).toBe('DELETE');
    expect(requested?.url).toContain(`/api/mypage/entries/${ENTRY_ID}`);
  });

  it('fails with 400 without calling the API when the entry id is malformed', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}', {status: 200});
    }) as typeof fetch;

    const result = await actions.cancel(
      buildCancelEvent(fetchImpl, 'not-a-uuid'),
    );

    expect(result).toMatchObject({status: 400});
    expect(called).toBe(false);
  });

  it('redirects to the login page when not logged in', async () => {
    await expect(
      actions.cancel(buildCancelEvent(fakeDeleteFetch(401))),
    ).rejects.toMatchObject({
      status: 303,
      location: '/mypage/login',
    } satisfies Partial<Redirect>);
  });

  it('fails with 404 when the entry is gone', async () => {
    const result = await actions.cancel(buildCancelEvent(fakeDeleteFetch(404)));

    expect(result).toMatchObject({status: 404});
  });

  it('fails with 502 when the cancellation request fails', async () => {
    const result = await actions.cancel(buildCancelEvent(fakeDeleteFetch(500)));

    expect(result).toMatchObject({status: 502});
  });
});
