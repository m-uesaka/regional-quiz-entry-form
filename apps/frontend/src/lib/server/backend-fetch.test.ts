import {describe, expect, it} from 'vitest';
import type {Cookies} from '@sveltejs/kit';
import {forwardBackendCookies, rewriteApiRequest} from './backend-fetch';

const FRONTEND_URL = new URL('https://entry.example/staff/dashboard');
const BACKEND_URL = 'https://backend.workers.example';

/** Calls `rewriteApiRequest` with the defaults every case shares. */
function rewrite(
  request: Request,
  overrides: {backendUrl?: string | undefined; cookie?: string | null} = {},
): Request | null {
  return rewriteApiRequest({
    request,
    frontendUrl: FRONTEND_URL,
    backendUrl: 'backendUrl' in overrides ? overrides.backendUrl : BACKEND_URL,
    cookie: overrides.cookie ?? null,
  });
}

describe('rewriteApiRequest', () => {
  it('points a same-origin /api request at the backend origin', () => {
    const rewritten = rewrite(
      new Request('https://entry.example/api/staff/dashboard'),
    );

    expect(rewritten?.url).toBe(
      'https://backend.workers.example/api/staff/dashboard',
    );
  });

  it('keeps the query string', () => {
    const rewritten = rewrite(
      new Request('https://entry.example/api/tournaments?regionSlug=kanto'),
    );

    expect(rewritten?.url).toBe(
      'https://backend.workers.example/api/tournaments?regionSlug=kanto',
    );
  });

  it('preserves the method, headers and body', async () => {
    const rewritten = rewrite(
      new Request('https://entry.example/api/entries', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: 'テスト太郎'}),
      }),
    );

    expect(rewritten?.method).toBe('POST');
    expect(rewritten?.headers.get('content-type')).toBe('application/json');
    await expect(rewritten?.text()).resolves.toBe('{"name":"テスト太郎"}');
  });

  it('forwards the incoming cookies to the backend', () => {
    const rewritten = rewrite(
      new Request('https://entry.example/api/mypage/entries'),
      {
        cookie: 'participant_session=token',
      },
    );

    expect(rewritten?.headers.get('cookie')).toBe('participant_session=token');
  });

  it('leaves the cookie header unset when the request carries none', () => {
    const rewritten = rewrite(new Request('https://entry.example/api/healthz'));

    expect(rewritten?.headers.has('cookie')).toBe(false);
  });

  it('rewrites a bare /api request', () => {
    const rewritten = rewrite(new Request('https://entry.example/api'));

    expect(rewritten?.url).toBe('https://backend.workers.example/api');
  });

  it('returns null for a same-origin request outside /api', () => {
    expect(rewrite(new Request('https://entry.example/apiece'))).toBeNull();
    expect(
      rewrite(new Request('https://entry.example/staff/dashboard')),
    ).toBeNull();
  });

  it('returns null for a cross-origin request', () => {
    expect(
      rewrite(new Request('https://other.example/api/healthz')),
    ).toBeNull();
  });

  it('throws when BACKEND_URL is unset', () => {
    expect(() =>
      rewrite(new Request('https://entry.example/api/healthz'), {
        backendUrl: undefined,
      }),
    ).toThrow(/BACKEND_URL is not set/);
  });

  it('throws when BACKEND_URL is not absolute', () => {
    expect(() =>
      rewrite(new Request('https://entry.example/api/healthz'), {
        backendUrl: '/api',
      }),
    ).toThrow(/not an absolute URL/);
  });
});

interface RecordedCookie {
  name: string;
  value: string;
  options: Parameters<Cookies['set']>[2];
}

/**
 * Builds a stand-in for `event.cookies` that records what was set on it.
 * @param recorded The array every `set()` call is appended to.
 */
function fakeCookies(recorded: RecordedCookie[]): Cookies {
  return {
    set: (
      name: string,
      value: string,
      options: Parameters<Cookies['set']>[2],
    ) => recorded.push({name, value, options}),
  } as unknown as Cookies;
}

/** Builds a response carrying the given `Set-Cookie` headers. */
function responseWithCookies(...setCookies: string[]): Response {
  const headers = new Headers();
  for (const setCookie of setCookies) headers.append('set-cookie', setCookie);
  return new Response(null, {headers});
}

const SESSION_COOKIE =
  'participant_session=eyJhbG.eyJzdWI.c2ln; Max-Age=604800; Path=/; ' +
  'HttpOnly; Secure; SameSite=Lax';

describe('forwardBackendCookies', () => {
  it("copies the backend's session cookie with its attributes", () => {
    const recorded: RecordedCookie[] = [];

    forwardBackendCookies(
      responseWithCookies(SESSION_COOKIE),
      fakeCookies(recorded),
      FRONTEND_URL,
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0].name).toBe('participant_session');
    expect(recorded[0].value).toBe('eyJhbG.eyJzdWI.c2ln');
    expect(recorded[0].options).toMatchObject({
      maxAge: 604800,
      path: '/',
      httpOnly: true,
      // From `FRONTEND_URL`'s own protocol, not from the header.
      secure: true,
      sameSite: 'lax',
    });
  });

  it('leaves the value untouched rather than encoding it a second time', () => {
    const recorded: RecordedCookie[] = [];

    forwardBackendCookies(
      responseWithCookies('token=a%2Bb; Path=/'),
      fakeCookies(recorded),
      FRONTEND_URL,
    );

    expect(recorded[0].value).toBe('a%2Bb');
    expect(recorded[0].options?.encode?.('a%2Bb')).toBe('a%2Bb');
  });

  it('copies every cookie when the backend sets more than one', () => {
    const recorded: RecordedCookie[] = [];

    forwardBackendCookies(
      responseWithCookies('first=1; Path=/', 'second=2; Path=/mypage'),
      fakeCookies(recorded),
      FRONTEND_URL,
    );

    expect(recorded.map(cookie => cookie.name)).toEqual(['first', 'second']);
    expect(recorded[1].options).toMatchObject({path: '/mypage'});
  });

  it('falls back to the widest path when the cookie carries none', () => {
    const recorded: RecordedCookie[] = [];

    forwardBackendCookies(
      responseWithCookies('pathless=1'),
      fakeCookies(recorded),
      FRONTEND_URL,
    );

    expect(recorded[0].options).toMatchObject({path: '/'});
  });

  it('drops a SameSite value that is not one of the three allowed ones', () => {
    const recorded: RecordedCookie[] = [];

    forwardBackendCookies(
      responseWithCookies('odd=1; Path=/; SameSite=Whenever'),
      fakeCookies(recorded),
      FRONTEND_URL,
    );

    expect(recorded[0].options?.sameSite).toBeUndefined();
  });

  it('sets nothing when the response carries no cookies', () => {
    const recorded: RecordedCookie[] = [];

    forwardBackendCookies(
      new Response(null),
      fakeCookies(recorded),
      FRONTEND_URL,
    );

    expect(recorded).toEqual([]);
  });

  it('leaves Secure off over plain HTTP, whatever the dev hostname is', () => {
    const recorded: RecordedCookie[] = [];

    // SvelteKit's own default only spares the literal hostname `localhost`,
    // so a LAN address under `vite dev --host` would get a `Secure` cookie
    // over plain HTTP and the browser would discard it without a word.
    forwardBackendCookies(
      responseWithCookies(SESSION_COOKIE),
      fakeCookies(recorded),
      new URL('http://192.168.1.20:5173/mypage'),
    );

    expect(recorded[0].options).toMatchObject({secure: false});
  });

  it('sets Secure over HTTPS even when the backend header omits it', () => {
    const recorded: RecordedCookie[] = [];

    forwardBackendCookies(
      responseWithCookies('plain=1; Path=/'),
      fakeCookies(recorded),
      FRONTEND_URL,
    );

    expect(recorded[0].options).toMatchObject({secure: true});
  });

  it("drops Domain so the frontend's own origin decides it", () => {
    const recorded: RecordedCookie[] = [];

    // The attribute describes where the *backend's* cookie may travel; this
    // one is being re-issued by the frontend instead.
    forwardBackendCookies(
      responseWithCookies('scoped=1; Path=/; Domain=backend.workers.example'),
      fakeCookies(recorded),
      FRONTEND_URL,
    );

    expect(recorded[0].options?.domain).toBeUndefined();
  });

  it('keeps an Expires attribute as a Date', () => {
    const recorded: RecordedCookie[] = [];

    forwardBackendCookies(
      responseWithCookies(
        'dated=1; Path=/; Expires=Wed, 09 Jun 2027 10:18:14 GMT',
      ),
      fakeCookies(recorded),
      FRONTEND_URL,
    );

    expect(recorded[0].options?.expires).toEqual(
      new Date('2027-06-09T10:18:14.000Z'),
    );
  });

  it('drops an Expires attribute it cannot parse', () => {
    const recorded: RecordedCookie[] = [];

    // An `Invalid Date` would make the `cookie` serializer throw, turning a
    // successful login into a 500.
    forwardBackendCookies(
      responseWithCookies('dated=1; Path=/; Max-Age=60; Expires=not-a-date'),
      fakeCookies(recorded),
      FRONTEND_URL,
    );

    expect(recorded[0].options?.expires).toBeUndefined();
    expect(recorded[0].options).toMatchObject({maxAge: 60});
  });
});
