import {describe, expect, it} from 'vitest';
import type {Cookies, HttpError, Redirect} from '@sveltejs/kit';
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

/**
 * Builds a stand-in for `event.cookies` that records the names deleted on
 * it, which is how a refused session is cleared.
 * @param deleted The array every `delete()` call appends its name to.
 */
function fakeCookies(deleted: string[]): Cookies {
  return {
    delete: (name: string) => deleted.push(name),
  } as unknown as Cookies;
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
): Parameters<typeof actions.cancel>[0] {
  const body = new FormData();
  body.set('entryId', entryId);
  return {
    fetch: fetchImpl,
    cookies: fakeCookies(deleted),
    url: new URL('http://localhost/mypage'),
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
    const deleted: string[] = [];
    const event = buildEvent(fakeFetch({status: 401}), deleted);

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: '/mypage/login',
    } satisfies Partial<Redirect>);
    // Without this the login page would send the same cookie straight back
    // here, since only the API can tell that it is no longer honoured.
    expect(deleted).toEqual(['participant_session']);
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
  it('forwards the deletion cookie and redirects to the login page', async () => {
    let requested: {url: string; method?: string} | undefined;
    // What `POST /api/auth/participant/logout` answers with, attributes and
    // all — the frontend has to re-issue it because the backend is a
    // different origin.
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requested = {url: String(input), method: init?.method};
      return new Response(JSON.stringify({ok: true}), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie':
            'participant_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
        },
      });
    }) as typeof fetch;

    const set: SetCookie[] = [];
    const deleted: string[] = [];

    await expect(
      actions.logout(buildLogoutEvent(fetchImpl, set, deleted)),
    ).rejects.toMatchObject({
      status: 303,
      location: '/mypage/login',
    } satisfies Partial<Redirect>);

    expect(requested?.method).toBe('POST');
    expect(requested?.url).toContain('/api/auth/participant/logout');
    expect(set).toHaveLength(1);
    expect(set[0]).toMatchObject({
      name: 'participant_session',
      value: '',
      options: {maxAge: 0, path: '/', httpOnly: true, sameSite: 'lax'},
    });
    // The forwarded deletion is enough; nothing else had to be dropped.
    expect(deleted).toEqual([]);
  });

  it('ends the session locally when the backend cannot be reached', async () => {
    const set: SetCookie[] = [];
    const deleted: string[] = [];
    // `handleFetch` throws outright on an unset or malformed `BACKEND_URL`,
    // and an unreachable Worker rejects the fetch. Neither answers with a
    // status to branch on.
    const rejecting = (async () => {
      throw new Error('BACKEND_URL is not set');
    }) as typeof fetch;

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
      actions.logout(buildLogoutEvent(fakeDeleteFetch(502), set, deleted)),
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
