import {describe, expect, it} from 'vitest';
import type {Cookies, Redirect} from '@sveltejs/kit';
import {
  fakeFetch,
  type RecordedRequest,
} from '../../../test-support/fake-fetch';
import {actions, load} from './+page.server';

/** A cookie written back on the response, as `Cookies.set()` took it. */
interface SetCookie {
  name: string;
  value: string;
  options: Parameters<Cookies['set']>[2];
}

/**
 * Builds a stand-in for `event.cookies` that records both the cookies
 * re-issued on it and the names deleted from it.
 * @param set The array every `set()` call appends to.
 * @param deleted The array every `delete()` call appends its name to.
 */
function fakeCookies(set: SetCookie[], deleted: string[]): Cookies {
  return {
    set: (name: string, value: string, options: SetCookie['options']) =>
      set.push({name, value, options}),
    delete: (name: string) => deleted.push(name),
  } as unknown as Cookies;
}

/** Builds the partial `RequestEvent` the logout action needs. */
function buildEvent(
  fetchImpl: typeof fetch,
  set: SetCookie[] = [],
  deleted: string[] = [],
): Parameters<typeof actions.default>[0] {
  return {
    fetch: fetchImpl,
    cookies: fakeCookies(set, deleted),
    url: new URL('http://localhost/staff/logout'),
  } as Parameters<typeof actions.default>[0];
}

/**
 * Builds a fake `fetch` answering the logout call with the given status.
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
        url: '/api/auth/staff/logout',
        status,
        body: {ok: status === 200},
      },
    ],
    requests,
  );
}

describe('staff logout +page.server load', () => {
  it('sends a visit to the login form, having nothing to show', () => {
    expect(() => load({} as Parameters<typeof load>[0])).toThrowError(
      expect.objectContaining({
        status: 303,
        location: '/staff/login',
      } satisfies Partial<Redirect>),
    );
  });
});

describe('staff logout +page.server action', () => {
  it('asks the API to end the session, then redirects to the login page', async () => {
    const requests: RecordedRequest[] = [];
    const set: SetCookie[] = [];
    const deleted: string[] = [];

    await expect(
      actions.default(buildEvent(fakeLogoutFetch(200, requests), set, deleted)),
    ).rejects.toMatchObject({
      status: 303,
      location: '/staff/login',
    } satisfies Partial<Redirect>);

    expect(requests).toEqual([
      {method: 'POST', url: '/api/auth/staff/logout', body: undefined},
    ]);
    // The deletion `Set-Cookie` rides back through `handleFetch`, not
    // through this action, so nothing is touched here on success.
    expect(set).toEqual([]);
    expect(deleted).toEqual([]);
  });

  it('ends the session locally when the backend cannot be reached', async () => {
    const set: SetCookie[] = [];
    const deleted: string[] = [];
    // A rejected fetch (unset `BACKEND_URL`, unreachable Worker) has no
    // status to branch on, and must not surface as a 500 with the session
    // left standing.
    const rejecting = fakeFetch([
      {
        method: 'POST',
        url: '/api/auth/staff/logout',
        respond: () => {
          throw new Error('BACKEND_URL is not set');
        },
      },
    ]);

    await expect(
      actions.default(buildEvent(rejecting, set, deleted)),
    ).rejects.toMatchObject({
      status: 303,
      location: '/staff/login',
    } satisfies Partial<Redirect>);

    expect(set).toEqual([]);
    expect(deleted).toEqual(['staff_session']);
  });

  it('ends the session locally when the logout request fails', async () => {
    const set: SetCookie[] = [];
    const deleted: string[] = [];

    await expect(
      actions.default(buildEvent(fakeLogoutFetch(502), set, deleted)),
    ).rejects.toMatchObject({
      status: 303,
      location: '/staff/login',
    } satisfies Partial<Redirect>);

    expect(set).toEqual([]);
    expect(deleted).toEqual(['staff_session']);
  });
});
