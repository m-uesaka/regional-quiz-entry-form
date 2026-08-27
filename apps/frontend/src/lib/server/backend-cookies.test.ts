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

// The header `apps/backend/src/routes/staff-auth.ts` issues on login.
const STAFF_SESSION_HEADER =
  'staff_session=header.payload.signature; Max-Age=43200; Path=/; ' +
  'HttpOnly; Secure; SameSite=Lax';

describe('forwardSetCookies', () => {
  it('re-issues the session cookie the backend set', () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(responseWith(STAFF_SESSION_HEADER), cookies);

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

    forwardSetCookies(responseWith(STAFF_SESSION_HEADER), cookies);

    const encode = set[0].options.encode ?? encodeURIComponent;
    expect(encode('a.b-c_d')).toBe('a.b-c_d');
  });

  it('drops Domain and Secure so the frontend origin decides them', () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(
      responseWith(`${STAFF_SESSION_HEADER}; Domain=api.example.com`),
      cookies,
    );

    expect(set[0].options).not.toHaveProperty('domain');
    expect(set[0].options).not.toHaveProperty('secure');
  });

  it('forwards every cookie of a multi-cookie response', () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(responseWith('a=1; Path=/', 'b=2; Path=/staff'), cookies);

    expect(set.map(cookie => [cookie.name, cookie.options.path])).toEqual([
      ['a', '/'],
      ['b', '/staff'],
    ]);
  });

  it('defaults a path-less cookie to the site root', () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(responseWith('staff_session=abc; HttpOnly'), cookies);

    expect(set[0].options.path).toBe('/');
  });

  it('keeps an Expires attribute as a Date', () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(
      responseWith('a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT'),
      cookies,
    );

    expect(set[0].options.expires).toEqual(
      new Date('2026-10-21T07:28:00.000Z'),
    );
  });

  it('ignores a header with no name=value pair', () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(responseWith('=nameless; Path=/'), cookies);

    expect(set).toHaveLength(0);
  });

  it('sets nothing when the response carries no cookies', () => {
    const {cookies, set} = recordingCookies();

    forwardSetCookies(responseWith(), cookies);

    expect(set).toHaveLength(0);
  });
});
