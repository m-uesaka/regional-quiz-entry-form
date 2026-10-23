import {describe, expect, it} from 'vitest';
import {sign} from 'hono/jwt';
import type {Cookies, Redirect} from '@sveltejs/kit';
import type {StaffClaims} from '@regional-quiz/shared';
import {
  clearStaffSession,
  readStaffClaims,
  redirectToStaffLogin,
} from './staff-session';

const SESSION_SECRET = 'test-session-secret';
const WRONG_SECRET = 'wrong-session-secret';

const STAFF_CLAIMS: StaffClaims = {
  sub: '33333333-3333-3333-3333-333333333333',
  role: 'general',
  regionId: null,
  tournamentType: null,
  sessionsValidFrom: 1756085025678,
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

  it('returns null for a token issued before sessionsValidFrom existed', async () => {
    // A cookie from before the claim was added can't name the generation of
    // sessions it belongs to. The backend refuses it outright, so it has to
    // read as logged out here too rather than as a session every API call
    // then rejects.
    const legacyClaims: Partial<StaffClaims> = {...STAFF_CLAIMS};
    delete legacyClaims.sessionsValidFrom;
    const token = await tokenFor(
      legacyClaims,
      Math.floor(Date.now() / 1000) + 3600,
      SESSION_SECRET,
    );

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

describe('redirectToStaffLogin', () => {
  it('drops the cookie the API refused and sends the page to the login form', () => {
    const deleted: string[] = [];
    const cookies = {
      delete: (name: string) => {
        deleted.push(name);
      },
    } as unknown as Cookies;

    let thrown: unknown;
    try {
      redirectToStaffLogin(
        cookies,
        new URL('https://entry.example.com/admin/staff?x=1'),
      );
    } catch (e: unknown) {
      thrown = e;
    }

    // A revoked session still verifies here, so the cookie has to go: kept,
    // it would keep passing for a session on every check this app makes.
    expect(deleted).toEqual(['staff_session']);
    expect(thrown).toMatchObject({
      status: 303,
      location: '/staff/login?redirectTo=%2Fadmin%2Fstaff%3Fx%3D1',
    } satisfies Partial<Redirect>);
  });
});
