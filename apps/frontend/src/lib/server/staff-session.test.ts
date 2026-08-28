import {describe, expect, it} from 'vitest';
import {sign} from 'hono/jwt';
import type {Cookies} from '@sveltejs/kit';
import type {StaffClaims} from '@regional-quiz/shared';
import {clearStaffSession, readStaffClaims} from './staff-session';

const SESSION_SECRET = 'test-session-secret';
const WRONG_SECRET = 'wrong-session-secret';

const STAFF_CLAIMS: StaffClaims = {
  sub: '33333333-3333-3333-3333-333333333333',
  role: 'general',
  regionId: null,
  tournamentType: null,
};

/** Signs `claims` (plus the given `exp`, if provided) with `secret`. */
async function tokenFor(
  claims: Record<string, unknown>,
  exp: number | undefined,
  secret: string,
): Promise<string> {
  return sign(exp === undefined ? claims : {...claims, exp}, secret);
}

describe('readStaffClaims', () => {
  it('returns null when the token is missing', async () => {
    await expect(
      readStaffClaims(undefined, SESSION_SECRET),
    ).resolves.toBeNull();
  });

  it('returns null when the secret is missing', async () => {
    const token = await tokenFor(
      STAFF_CLAIMS,
      Math.floor(Date.now() / 1000) + 3600,
      SESSION_SECRET,
    );

    await expect(readStaffClaims(token, undefined)).resolves.toBeNull();
  });

  it('returns the parsed claims for a validly signed, unexpired token', async () => {
    const token = await tokenFor(
      STAFF_CLAIMS,
      Math.floor(Date.now() / 1000) + 3600,
      SESSION_SECRET,
    );

    await expect(readStaffClaims(token, SESSION_SECRET)).resolves.toEqual(
      STAFF_CLAIMS,
    );
  });

  it('returns null for an expired token', async () => {
    const token = await tokenFor(
      STAFF_CLAIMS,
      Math.floor(Date.now() / 1000) - 3600,
      SESSION_SECRET,
    );

    await expect(readStaffClaims(token, SESSION_SECRET)).resolves.toBeNull();
  });

  it('returns null for a validly signed token with no exp claim', async () => {
    const token = await tokenFor(STAFF_CLAIMS, undefined, SESSION_SECRET);

    await expect(readStaffClaims(token, SESSION_SECRET)).resolves.toBeNull();
  });

  it('returns null for a malformed token', async () => {
    await expect(
      readStaffClaims('not-a-real-token', SESSION_SECRET),
    ).resolves.toBeNull();
  });

  it('returns null for a token signed with the wrong secret', async () => {
    const token = await tokenFor(
      STAFF_CLAIMS,
      Math.floor(Date.now() / 1000) + 3600,
      WRONG_SECRET,
    );

    await expect(readStaffClaims(token, SESSION_SECRET)).resolves.toBeNull();
  });
});

describe('clearStaffSession', () => {
  /** Records what `Cookies.delete()` was called with. */
  function fakeCookies(
    deleted: Array<{name: string; options: Parameters<Cookies['delete']>[1]}>,
  ): Cookies {
    return {
      delete: (name: string, options: Parameters<Cookies['delete']>[1]) =>
        deleted.push({name, options}),
    } as unknown as Cookies;
  }

  it('deletes the session cookie under the path the backend set it on', () => {
    const deleted: Array<{
      name: string;
      options: Parameters<Cookies['delete']>[1];
    }> = [];

    clearStaffSession(
      fakeCookies(deleted),
      new URL('https://entry.example.com/staff/logout'),
    );

    expect(deleted).toEqual([
      {name: 'staff_session', options: {path: '/', secure: true}},
    ]);
  });

  it('drops Secure when the frontend is served over plain HTTP', () => {
    const deleted: Array<{
      name: string;
      options: Parameters<Cookies['delete']>[1];
    }> = [];

    // A `Secure` deletion over plain HTTP is discarded by the browser, so
    // the session it was meant to end would survive.
    clearStaffSession(
      fakeCookies(deleted),
      new URL('http://127.0.0.1:5173/staff/logout'),
    );

    expect(deleted).toEqual([
      {name: 'staff_session', options: {path: '/', secure: false}},
    ]);
  });
});
