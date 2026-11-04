import {describe, expect, it} from 'vitest';
import type {Cookies, HttpError, Redirect} from '@sveltejs/kit';
import type {MypageEntry} from '@regional-quiz/shared';
import {fakeCookies} from '../../test-support/fake-cookies';
import {fakeFetch, type RecordedRequest} from '../../test-support/fake-fetch';
import {
  fakePlatform,
  TOKYO_SAIKYOI_LIST_KEY,
} from '../../test-support/fake-platform';
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
      regionSlug: 'tokyo',
      entryOpensAt: '2020-01-01T00:00:00.000Z',
      entryClosesAt: '2099-01-01T00:00:00.000Z',
    },
  },
];

/** Builds a fake `fetch` returning the given entries and status. */
function fakeApi(options: {
  entries?: MypageEntry[];
  status?: number;
}): typeof fetch {
  return fakeFetch([
    {
      method: 'GET',
      url: /^\/api\/mypage\/entries$/,
      status: options.status ?? 200,
      body: options.entries ?? [],
    },
  ]);
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildEvent(
  fetchImpl: typeof fetch,
  deleted: string[] = [],
): Parameters<typeof load>[0] {
  return {
    fetch: fetchImpl,
    cookies: fakeCookies(deleted),
    url: new URL('http://localhost/mypage'),
  } as Parameters<typeof load>[0];
}

const ENTRY_ID = ENTRIES[0].id;

/**
 * Builds the partial `RequestEvent` the `cancel` action needs, carrying the
 * given entry id as the submitted form body.
 */
function buildCancelEvent(
  fetchImpl: typeof fetch,
  entryId: string = ENTRY_ID,
  deleted: string[] = [],
  options: {platform?: App.Platform; withTournament?: boolean} = {},
): Parameters<typeof actions.cancel>[0] {
  const body = new FormData();
  body.set('entryId', entryId);
  // The hidden fields `+page.svelte` puts next to the entry id.
  if (options.withTournament ?? true) {
    body.set('regionSlug', ENTRIES[0].tournament.regionSlug);
    body.set('tournamentType', ENTRIES[0].tournament.type);
  }
  return {
    fetch: fetchImpl,
    platform: options.platform,
    cookies: fakeCookies(deleted),
    url: new URL('http://localhost/mypage'),
    request: new Request('http://localhost/mypage?/cancel', {
      method: 'POST',
      body,
    }),
  } as Parameters<typeof actions.cancel>[0];
}

/**
 * Builds a fake `fetch` answering the DELETE of `ENTRY_ID` with the given
 * status.
 * @param requests Collects the requests sent.
 */
function fakeDeleteFetch(
  status: number,
  requests?: RecordedRequest[],
): typeof fetch {
  return fakeFetch(
    [
      {
        method: 'DELETE',
        url: `/api/mypage/entries/${ENTRY_ID}`,
        status,
        body: status === 200 ? {ok: true} : {},
      },
    ],
    requests,
  );
}

describe('mypage +page.server load', () => {
  it("returns the logged-in participant's entries", async () => {
    const event = buildEvent(fakeApi({entries: ENTRIES}));

    await expect(load(event)).resolves.toEqual({entries: ENTRIES});
  });

  it('redirects to the login page when not logged in', async () => {
    const deleted: string[] = [];
    const event = buildEvent(fakeApi({status: 401}), deleted);

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: '/mypage/login',
    } satisfies Partial<Redirect>);
    // Without this the login page would send the same cookie straight back
    // here, since only the API can tell that it is no longer honoured.
    expect(deleted).toEqual(['participant_session']);
  });

  it('throws 502 when the entries request fails', async () => {
    const event = buildEvent(fakeApi({status: 500}));

    await expect(load(event)).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });
});

describe('mypage +page.server cancel action', () => {
  it('drops the cached public list of the cancelled entry (#125)', async () => {
    const {platform, stored} = fakePlatform();
    stored.set(TOKYO_SAIKYOI_LIST_KEY, Response.json([]));

    await actions.cancel(
      buildCancelEvent(fakeDeleteFetch(200), ENTRY_ID, [], {platform}),
    );

    expect(stored.has(TOKYO_SAIKYOI_LIST_KEY)).toBe(false);
  });

  it('keeps the cached list when the cancellation fails', async () => {
    const {platform, stored} = fakePlatform();
    stored.set(TOKYO_SAIKYOI_LIST_KEY, Response.json([]));

    await actions.cancel(
      buildCancelEvent(fakeDeleteFetch(500), ENTRY_ID, [], {platform}),
    );

    expect(stored.has(TOKYO_SAIKYOI_LIST_KEY)).toBe(true);
  });

  it('still cancels when the form does not name the tournament', async () => {
    const {platform} = fakePlatform();

    await expect(
      actions.cancel(
        buildCancelEvent(fakeDeleteFetch(200), ENTRY_ID, [], {
          platform,
          withTournament: false,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('still cancels when the cache cannot be reached', async () => {
    const {platform} = fakePlatform({failDelete: true});

    await expect(
      actions.cancel(
        buildCancelEvent(fakeDeleteFetch(200), ENTRY_ID, [], {platform}),
      ),
    ).resolves.toBeUndefined();
  });

  it('cancels the entry the form names', async () => {
    const requests: RecordedRequest[] = [];

    await expect(
      actions.cancel(buildCancelEvent(fakeDeleteFetch(200, requests))),
    ).resolves.toBeUndefined();
    expect(requests).toEqual([
      {
        method: 'DELETE',
        url: `/api/mypage/entries/${ENTRY_ID}`,
        body: undefined,
      },
    ]);
  });

  it('fails with 400 without calling the API when the entry id is malformed', async () => {
    const requests: RecordedRequest[] = [];

    const result = await actions.cancel(
      buildCancelEvent(fakeFetch([], requests), 'not-a-uuid'),
    );

    expect(result).toMatchObject({status: 400});
    expect(requests).toEqual([]);
  });

  it('redirects to the login page when not logged in', async () => {
    const deleted: string[] = [];

    await expect(
      actions.cancel(buildCancelEvent(fakeDeleteFetch(401), ENTRY_ID, deleted)),
    ).rejects.toMatchObject({
      status: 303,
      location: '/mypage/login',
    } satisfies Partial<Redirect>);
    expect(deleted).toEqual(['participant_session']);
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

/** A cookie written back on the response, as `Cookies.set()` took it. */
interface SetCookie {
  name: string;
  value: string;
  options: Parameters<Cookies['set']>[2];
}

/**
 * Builds a stand-in for `event.cookies` that records both the cookies
 * re-issued on it and the names deleted from it — the two ways the session
 * can be ended here.
 * @param set The array every `set()` call appends to.
 * @param deleted The array every `delete()` call appends its name to.
 */
function fakeLogoutCookies(set: SetCookie[], deleted: string[]): Cookies {
  return {
    set: (name: string, value: string, options: SetCookie['options']) =>
      set.push({name, value, options}),
    delete: (name: string) => deleted.push(name),
  } as unknown as Cookies;
}

/**
 * Builds a fake `fetch` answering the logout POST with the given status.
 * @param requests Collects the requests sent.
 */
function fakeLogoutFetch(
  status: number,
  requests?: RecordedRequest[],
): typeof fetch {
  return fakeFetch(
    [
      {
        method: 'POST',
        url: '/api/auth/participant/logout',
        status,
        body: status === 200 ? {ok: true} : {},
      },
    ],
    requests,
  );
}

/** Builds the partial `RequestEvent` the `logout` action needs. */
function buildLogoutEvent(
  fetchImpl: typeof fetch,
  set: SetCookie[] = [],
  deleted: string[] = [],
): Parameters<typeof actions.logout>[0] {
  return {
    fetch: fetchImpl,
    cookies: fakeLogoutCookies(set, deleted),
    url: new URL('http://localhost/mypage'),
  } as Parameters<typeof actions.logout>[0];
}

describe('mypage +page.server logout action', () => {
  it('asks the API to end the session, then redirects to the login page', async () => {
    const requests: RecordedRequest[] = [];
    const set: SetCookie[] = [];
    const deleted: string[] = [];

    await expect(
      actions.logout(
        buildLogoutEvent(fakeLogoutFetch(200, requests), set, deleted),
      ),
    ).rejects.toMatchObject({
      status: 303,
      location: '/mypage/login',
    } satisfies Partial<Redirect>);

    expect(requests).toEqual([
      {method: 'POST', url: '/api/auth/participant/logout', body: undefined},
    ]);
    // The deletion `Set-Cookie` the API answers with is carried into the
    // cookie jar by `handleFetch`, not by the action -- so a successful
    // logout touches no cookie here. `forwardBackendCookies` in
    // `$lib/server/backend-fetch` is where that is covered.
    expect(set).toEqual([]);
    expect(deleted).toEqual([]);
  });

  it('ends the session locally when the backend cannot be reached', async () => {
    const set: SetCookie[] = [];
    const deleted: string[] = [];
    // `handleFetch` throws outright on an unset or malformed `BACKEND_URL`,
    // and an unreachable Worker rejects the fetch. Neither answers with a
    // status to branch on.
    const rejecting = fakeFetch([
      {
        method: 'POST',
        url: '/api/auth/participant/logout',
        respond: () => {
          throw new Error('BACKEND_URL is not set');
        },
      },
    ]);

    await expect(
      actions.logout(buildLogoutEvent(rejecting, set, deleted)),
    ).rejects.toMatchObject({
      status: 303,
      location: '/mypage/login',
    } satisfies Partial<Redirect>);

    expect(set).toEqual([]);
    expect(deleted).toEqual(['participant_session']);
  });

  it('ends the session locally when the logout request fails', async () => {
    const set: SetCookie[] = [];
    const deleted: string[] = [];

    await expect(
      actions.logout(buildLogoutEvent(fakeLogoutFetch(502), set, deleted)),
    ).rejects.toMatchObject({
      status: 303,
      location: '/mypage/login',
    } satisfies Partial<Redirect>);

    // No deletion cookie came back, so the participant would otherwise stay
    // logged in on a screen that just told them they were logged out.
    expect(set).toEqual([]);
    expect(deleted).toEqual(['participant_session']);
  });
});
