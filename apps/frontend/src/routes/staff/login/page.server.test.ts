import {describe, expect, it} from 'vitest';
import type {Cookies, Redirect} from '@sveltejs/kit';
import type {StaffLoginResponse} from '@regional-quiz/shared';
import {
  fakeFetch,
  type RecordedRequest,
} from '../../../test-support/fake-fetch';
import {fakeCookieJar} from '../../../test-support/fake-cookies';
import {STAFF_PENDING_INVITES_COOKIE} from '$lib/server/staff-pending-invites';
import {actions, load} from './+page.server';

const REGIONAL: StaffLoginResponse = {
  ok: true,
  role: 'regional',
  regionSlug: 'tokyo',
  tournamentType: 'saikyoi',
  pendingInviteScopes: [],
};

const GENERAL: StaffLoginResponse = {
  ok: true,
  role: 'general',
  regionSlug: null,
  tournamentType: null,
  pendingInviteScopes: [],
};

const SESSION_COOKIE_HEADER =
  'staff_session=header.payload.signature; Max-Age=43200; Path=/; ' +
  'HttpOnly; Secure; SameSite=Lax';

/** One `cookies.set()` call, as `recordingCookies()` captures it. */
interface RecordedCookie {
  name: string;
  value: string;
}

function recordingCookies(): {cookies: Cookies; set: RecordedCookie[]} {
  const set: RecordedCookie[] = [];
  const cookies = {
    set: (name: string, value: string) => {
      set.push({name, value});
    },
  } as unknown as Cookies;
  return {cookies, set};
}

/**
 * Builds a fake `fetch` answering the login request as given.
 * @param options.requests Collects the requests sent.
 */
function fakeLoginFetch(
  options: {
    status?: number;
    body?: unknown;
    setCookie?: string | null;
    requests?: RecordedRequest[];
  } = {},
): typeof fetch {
  return fakeFetch(
    [
      {
        method: 'POST',
        url: '/api/auth/staff/login',
        respond: () => {
          const headers = new Headers({'Content-Type': 'application/json'});
          const setCookie = options.setCookie ?? SESSION_COOKIE_HEADER;
          if (setCookie) headers.append('set-cookie', setCookie);
          return new Response(JSON.stringify(options.body ?? REGIONAL), {
            status: options.status ?? 200,
            headers,
          });
        },
      },
    ],
    options.requests,
  );
}

/** Builds the partial `RequestEvent` the login action needs. */
function buildEvent(options: {
  fetch?: typeof fetch;
  cookies?: Cookies;
  email?: string;
  scope?: string;
  password?: string;
  redirectTo?: string;
}): Parameters<typeof actions.default>[0] {
  const body = new FormData();
  if (options.email !== undefined) body.set('email', options.email);
  if (options.scope !== undefined) body.set('scope', options.scope);
  if (options.password !== undefined) body.set('password', options.password);

  const url = new URL('http://localhost/staff/login');
  if (options.redirectTo)
    url.searchParams.set('redirectTo', options.redirectTo);

  return {
    fetch: options.fetch ?? fakeLoginFetch(),
    cookies: options.cookies ?? recordingCookies().cookies,
    url,
    request: new Request(url, {method: 'POST', body}),
  } as Parameters<typeof actions.default>[0];
}

const CREDENTIALS = {
  email: 'staff@example.com',
  scope: 'saikyoi',
  password: 'correct-password',
};

describe('staff login action', () => {
  it("sends regional staff to their own tournament's entry list", async () => {
    const event = buildEvent(CREDENTIALS);

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/staff/tokyo/saikyoi/entries',
    } satisfies Partial<Redirect>);
  });

  it('sends general staff to the cross-region dashboard', async () => {
    const event = buildEvent({
      ...CREDENTIALS,
      fetch: fakeLoginFetch({body: GENERAL}),
    });

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/staff/dashboard',
    } satisfies Partial<Redirect>);
  });

  it('sends them back to the page they were aiming at', async () => {
    const event = buildEvent({
      ...CREDENTIALS,
      fetch: fakeLoginFetch({body: GENERAL}),
      redirectTo: '/staff/tokyo/shinjinou/entries',
    });

    await expect(actions.default(event)).rejects.toMatchObject({
      status: 303,
      location: '/staff/tokyo/shinjinou/entries',
    } satisfies Partial<Redirect>);
  });

  it('leaves re-issuing the session cookie to handleFetch', async () => {
    const {cookies, set} = recordingCookies();

    await expect(
      actions.default(buildEvent({...CREDENTIALS, cookies})),
    ).rejects.toMatchObject({status: 303} satisfies Partial<Redirect>);
    // `hooks.server.ts` moves the backend's `Set-Cookie` into SvelteKit's
    // cookie jar as the call comes back (see `forwardBackendCookies()` in
    // `$lib/server/backend-fetch`), so the action writes no cookie itself.
    expect(set).toEqual([]);
  });

  it('leaves the landing page a warning about accounts still waiting on their invite', async () => {
    const jar = fakeCookieJar();

    await expect(
      actions.default(
        buildEvent({
          ...CREDENTIALS,
          cookies: jar.cookies,
          fetch: fakeLoginFetch({
            body: {...REGIONAL, pendingInviteScopes: ['shinjinou']},
          }),
        }),
      ),
    ).rejects.toMatchObject({
      status: 303,
      location: '/staff/tokyo/saikyoi/entries',
    } satisfies Partial<Redirect>);
    expect(jar.jar.get(STAFF_PENDING_INVITES_COOKIE)).toBe('shinjinou');
    expect(jar.setOptions.get(STAFF_PENDING_INVITES_COOKIE)).toMatchObject({
      path: '/',
      httpOnly: true,
    });
  });

  it('reports a rejected login without saying which field was wrong', async () => {
    const event = buildEvent({
      ...CREDENTIALS,
      fetch: fakeLoginFetch({
        status: 401,
        body: {error: 'invalid credentials'},
      }),
    });

    const result = await actions.default(event);

    expect(result).toMatchObject({
      status: 401,
      data: {
        email: CREDENTIALS.email,
        scope: CREDENTIALS.scope,
        error:
          'メールアドレス・区分・パスワードのいずれかが正しくありません。' +
          '招待メールのリンクからパスワードを設定していない場合も、このエラーになります',
      },
    });
  });

  it('asks the staff member to wait when the API rate limits the login', async () => {
    // 429 rather than 401: the password was never checked, so "wrong
    // credentials" would be both wrong and unhelpful.
    const event = buildEvent({
      ...CREDENTIALS,
      fetch: fakeLoginFetch({status: 429, body: {error: 'too many requests'}}),
    });

    const result = await actions.default(event);

    expect(result).toMatchObject({
      status: 429,
      data: {
        email: CREDENTIALS.email,
        error:
          'ログインの試行が集中しています。しばらく待ってから再度お試しください',
      },
    });
  });

  it('keeps no session cookie when the login was rejected', async () => {
    const {cookies, set} = recordingCookies();

    await actions.default(
      buildEvent({
        ...CREDENTIALS,
        cookies,
        fetch: fakeLoginFetch({
          status: 401,
          body: {error: 'invalid credentials'},
        }),
      }),
    );

    expect(set).toEqual([]);
  });

  // #166: the address alone no longer names one account.
  it('sends the chosen 区分 along with the address', async () => {
    const requests: RecordedRequest[] = [];
    const event = buildEvent({
      ...CREDENTIALS,
      email: 'Staff@Example.com',
      scope: 'shinjinou',
      fetch: fakeLoginFetch({requests}),
    });

    await expect(actions.default(event)).rejects.toMatchObject({status: 303});
    // Lowercased by the shared schema on the way out (#133).
    expect(requests.map(r => r.body)).toEqual([
      {
        email: 'staff@example.com',
        scope: 'shinjinou',
        password: CREDENTIALS.password,
      },
    ]);
  });

  it('refuses a login with no 区分 chosen without calling the API', async () => {
    const requests: RecordedRequest[] = [];
    const event = buildEvent({
      email: CREDENTIALS.email,
      scope: '',
      password: CREDENTIALS.password,
      fetch: fakeFetch([], requests),
    });

    const result = await actions.default(event);

    expect(result).toMatchObject({
      status: 400,
      data: {email: CREDENTIALS.email, scope: ''},
    });
    expect(requests).toEqual([]);
  });

  it('rejects an empty form without calling the API', async () => {
    const requests: RecordedRequest[] = [];
    const event = buildEvent({
      email: '',
      password: '',
      fetch: fakeFetch([], requests),
    });

    const result = await actions.default(event);

    expect(result).toMatchObject({status: 400});
    expect(requests).toEqual([]);
  });

  it('reports a backend failure as a retryable error', async () => {
    const event = buildEvent({
      ...CREDENTIALS,
      fetch: fakeLoginFetch({
        status: 500,
        body: {error: 'internal server error'},
      }),
    });

    const result = await actions.default(event);

    expect(result).toMatchObject({status: 502});
  });

  it('says so when the account has no screen to land on', async () => {
    const event = buildEvent({
      ...CREDENTIALS,
      fetch: fakeLoginFetch({
        body: {...REGIONAL, regionSlug: null, tournamentType: null},
      }),
    });

    const result = await actions.default(event);

    expect(result).toMatchObject({status: 500});
  });
});

describe('staff login +page.server load', () => {
  /** Builds the partial `RequestEvent` `load` needs, cast for test use. */
  function buildLoadEvent(url: string): Parameters<typeof load>[0] {
    return {url: new URL(url)} as Parameters<typeof load>[0];
  }

  it('reports the password a staff member just set from their link', () => {
    expect(
      load(buildLoadEvent('http://localhost/staff/login?reset=done')),
    ).toEqual({passwordSet: true});
  });

  it('reports nothing for an ordinary visit', () => {
    expect(load(buildLoadEvent('http://localhost/staff/login'))).toEqual({
      passwordSet: false,
    });
  });
});
