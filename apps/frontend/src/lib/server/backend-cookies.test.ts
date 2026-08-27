import {describe, expect, it} from 'vitest';
import type {Cookies} from '@sveltejs/kit';
import {forwardSetCookies} from './backend-cookies';

/** One `cookies.set()` call, as `recordingCookies()` captures it. */
interface RecordedCookie {
  name: string;
  value: string;
  options: Parameters<Cookies['set']>[2];
}

/** A `Cookies` stand-in that records what was set on it. */
function recordingCookies(): {cookies: Cookies; set: RecordedCookie[]} {
  const set: RecordedCookie[] = [];
  const cookies = {
    set: (name: string, value: string, options: RecordedCookie['options']) => {
      set.push({name, value, options});
    },
  } as unknown as Cookies;
  return {cookies, set};
}

/** A response carrying the given `Set-Cookie` headers. */
function responseWith(...headers: string[]): Response {
  const response = new Response(null);
  for (const header of headers) {
    response.headers.append('set-cookie', header);
  }
  return response;
}

// A development frontend origin, as `bun run dev` serves it. Not `localhost`
// on purpose: `.env.example` points development at `127.0.0.1`, and that is
// exactly the case SvelteKit's own `secure` default gets wrong.
const DEV_URL = new URL('http://127.0.0.1:5173/staff/login');

// The header `apps/backend/src/routes/staff-auth.ts` issues on login.
const STAFF_SESSION_HEADER =
  'staff_session=header.payload.signature; Max-Age=43200; Path=/; ' +
  'HttpOnly; Secure; SameSite=Lax';

describe('forwardSetCookies', () => {
  it('re-issues the session cookie the backend set', () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(responseWith(STAFF_SESSION_HEADER), cookies, DEV_URL);

    expect(set).toHaveLength(1);
    expect(set[0].name).toBe('staff_session');
    expect(set[0].value).toBe('header.payload.signature');
    expect(set[0].options).toMatchObject({
      path: '/',
      maxAge: 43200,
      httpOnly: true,
      sameSite: 'lax',
    });
  });

  it('leaves the JWT value untouched instead of percent-encoding it again', () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(responseWith(STAFF_SESSION_HEADER), cookies, DEV_URL);

    const encode = set[0].options.encode ?? encodeURIComponent;
    expect(encode('a.b-c_d')).toBe('a.b-c_d');
  });

  it("drops Domain so the frontend's own origin decides it", () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(
      responseWith(`${STAFF_SESSION_HEADER}; Domain=api.example.com`),
      cookies,
      DEV_URL,
    );

    expect(set[0].options).not.toHaveProperty('domain');
  });

  it('leaves Secure off over plain HTTP, whatever the dev hostname is', () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(responseWith(STAFF_SESSION_HEADER), cookies, DEV_URL);

    // A `Secure` cookie over `http://` is discarded by the browser without an
    // error, which would look like a login that succeeds and then loops back
    // to the form.
    expect(set[0].options.secure).toBe(false);
  });

  it('sets Secure over HTTPS even when the backend header omits it', () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(
      responseWith('staff_session=abc; Path=/; HttpOnly'),
      cookies,
      new URL('https://entry.example.com/staff/login'),
    );

    expect(set[0].options.secure).toBe(true);
  });

  it('forwards every cookie of a multi-cookie response', () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(
      responseWith('a=1; Path=/', 'b=2; Path=/staff'),
      cookies,
      DEV_URL,
    );

    expect(set.map(cookie => [cookie.name, cookie.options.path])).toEqual([
      ['a', '/'],
      ['b', '/staff'],
    ]);
  });

  it('defaults a path-less cookie to the site root', () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(
      responseWith('staff_session=abc; HttpOnly'),
      cookies,
      DEV_URL,
    );

    expect(set[0].options.path).toBe('/');
  });

  it('keeps an Expires attribute as a Date', () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(
      responseWith('a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT'),
      cookies,
      DEV_URL,
    );

    expect(set[0].options.expires).toEqual(
      new Date('2026-10-21T07:28:00.000Z'),
    );
  });

  it('drops an Expires attribute it cannot parse', () => {
    const {cookies, set} = recordingCookies();

    // `cookies.set()` throws on an `Invalid Date`, which would turn a
    // successful login into a 500.
    forwardSetCookies(
      responseWith('a=1; Max-Age=60; Expires=not-a-date'),
      cookies,
      DEV_URL,
    );

    expect(set[0].options).not.toHaveProperty('expires');
    expect(set[0].options.maxAge).toBe(60);
  });

  it('ignores a header with no name=value pair', () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(responseWith('=nameless; Path=/'), cookies, DEV_URL);

    expect(set).toHaveLength(0);
  });

  it('sets nothing when the response carries no cookies', () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(responseWith(), cookies, DEV_URL);

    expect(set).toHaveLength(0);
  });
});
