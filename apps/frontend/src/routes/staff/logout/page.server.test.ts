import {describe, expect, it} from 'vitest';
import type {Cookies, Redirect} from '@sveltejs/kit';
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

/** Builds a fake `fetch` answering the logout call with the given status. */
function fakeLogoutFetch(status: number): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ok: status === 200}), {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...(status === 200
          ? {
              'Set-Cookie':
                'staff_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
            }
          : {}),
      },
    })) as typeof fetch;
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
  it('forwards the deletion cookie and redirects to the login page', async () => {
    let requested: {url: string; method?: string} | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requested = {url: String(input), method: init?.method};
      return fakeLogoutFetch(200)(input, init);
    }) as typeof fetch;

    const set: SetCookie[] = [];
    const deleted: string[] = [];

    await expect(
      actions.default(buildEvent(fetchImpl, set, deleted)),
    ).rejects.toMatchObject({
      status: 303,
      location: '/staff/login',
    } satisfies Partial<Redirect>);

    expect(requested?.method).toBe('POST');
    expect(requested?.url).toContain('/api/auth/staff/logout');
    expect(set).toHaveLength(1);
    expect(set[0]).toMatchObject({
      name: 'staff_session',
      value: '',
      options: {maxAge: 0, path: '/', httpOnly: true, sameSite: 'lax'},
    });
    expect(deleted).toEqual([]);
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
