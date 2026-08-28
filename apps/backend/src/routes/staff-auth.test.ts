import {afterEach, describe, expect, it} from 'bun:test';
import {staffAuthRoute} from './staff-auth';
import {hashPassword, UNUSABLE_PASSWORD_HASH} from '../lib/password';
import type {Bindings} from '../types/env';
import {
  PERMISSIVE_SECURITY_BINDINGS,
  refusingRateLimiter,
} from '../test-support/bindings';

const ENV: Bindings = {
  ...PERMISSIVE_SECURITY_BINDINGS,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

const STAFF_ID = '33333333-3333-3333-3333-333333333333';
const REGION_ID = '11111111-1111-1111-1111-111111111111';
const REGION_SLUG = 'tokyo';

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payloadSegment = token.split('.')[1];
  const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64)) as Record<string, unknown>;
}

/** A `regional` staff row as the login query selects it. */
function regionalStaffRow(passwordHash: string): Record<string, unknown> {
  return {
    id: STAFF_ID,
    password_hash: passwordHash,
    role: 'regional',
    region_id: REGION_ID,
    tournament_type: 'saikyoi',
    regions: {slug: REGION_SLUG},
  };
}

function mockStaffAccountFetch(row: Record<string, unknown> | null): void {
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json(row ? [row] : []),
    )) as unknown as typeof fetch;
}

/**
 * Posts a login request for the mocked account.
 * @param password The password to submit.
 * @param email The address to submit.
 */
async function login(
  password: string,
  email = 'staff@example.com',
): Promise<Response> {
  return staffAuthRoute.request(
    '/login',
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email, password}),
    },
    ENV,
  );
}

describe('POST /login', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('issues a JWT cookie whose claims include role, regionId, and tournamentType', async () => {
    mockStaffAccountFetch(
      regionalStaffRow(await hashPassword('correct-password')),
    );

    const res = await login('correct-password');

    expect(res.status).toBe(200);

    const setCookieHeader = res.headers.get('set-cookie') ?? '';
    expect(setCookieHeader).toContain('staff_session=');
    expect(setCookieHeader).toContain('HttpOnly');

    const token = setCookieHeader.split('staff_session=')[1].split(';')[0];
    expect(decodeJwtPayload(token)).toMatchObject({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });
  });

  it("answers regional staff with their own tournament's region slug", async () => {
    mockStaffAccountFetch(
      regionalStaffRow(await hashPassword('correct-password')),
    );

    const res = await login('correct-password');

    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toEqual({
      ok: true,
      role: 'regional',
      regionSlug: REGION_SLUG,
      tournamentType: 'saikyoi',
    });
  });

  it('answers general staff with a null region slug and tournament type', async () => {
    mockStaffAccountFetch({
      id: STAFF_ID,
      password_hash: await hashPassword('correct-password'),
      role: 'general',
      region_id: null,
      tournament_type: null,
      regions: null,
    });

    const res = await login('correct-password');

    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toEqual({
      ok: true,
      role: 'general',
      regionSlug: null,
      tournamentType: null,
    });
  });

  it('returns 401 for a wrong password', async () => {
    mockStaffAccountFetch(
      regionalStaffRow(await hashPassword('correct-password')),
    );

    const res = await login('wrong-password');

    expect(res.status).toBe(401);
  });

  it('returns 401 when no staff account matches the email', async () => {
    mockStaffAccountFetch(null);

    const res = await login('anything', 'unknown@example.com');

    expect(res.status).toBe(401);
  });

  it('returns 429 with Retry-After when the rate limiter refuses', async () => {
    mockStaffAccountFetch(regionalStaffRow(await hashPassword('correct')));

    const res = await staffAuthRoute.request(
      '/login',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          email: 'staff@example.com',
          password: 'correct',
        }),
      },
      {...ENV, LOGIN_IP_RATE_LIMITER: refusingRateLimiter()},
    );

    const body: unknown = await res.json();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(body).toEqual({error: 'too many requests'});
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('counts the per-account limit under a key naming this endpoint', async () => {
    // The other half of what `routes/participant-auth.ts` explains: the two
    // logins must not share a per-account bucket for the same address.
    mockStaffAccountFetch(null);
    const keys: string[] = [];
    const recording: RateLimit = {
      limit: ({key}) => {
        keys.push(key ?? '');
        return Promise.resolve({success: true});
      },
    };

    await staffAuthRoute.request(
      '/login',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          email: 'Shared@Example.com',
          password: 'anything',
        }),
      },
      {...ENV, LOGIN_EMAIL_RATE_LIMITER: recording},
    );

    expect(keys).toEqual(['staff-login:email:shared@example.com']);
  });

  it('refuses an account that has not set a password yet', async () => {
    // What `POST /api/staff/accounts` writes: the row exists, but its owner
    // hasn't followed the invite link, so no password can match.
    mockStaffAccountFetch(regionalStaffRow(UNUSABLE_PASSWORD_HASH));

    const res = await login(UNUSABLE_PASSWORD_HASH);

    expect(res.status).toBe(401);
    expect((await res.json()) as Record<string, unknown>).toEqual({
      error: 'invalid credentials',
    });
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

describe('POST /logout', () => {
  it('clears the staff session cookie', async () => {
    // No account lookup and no session are involved: the handler only
    // answers with the deletion cookie.
    const res = await staffAuthRoute.request('/logout', {method: 'POST'}, ENV);

    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toEqual({
      ok: true,
    });

    const setCookieHeader = res.headers.get('set-cookie') ?? '';
    expect(setCookieHeader).toContain('staff_session=;');
    expect(setCookieHeader).toContain('Max-Age=0');
    // The attributes have to match the ones `/login` issues, or the browser
    // reads this as a different cookie and keeps the live session.
    expect(setCookieHeader).toContain('Path=/');
    expect(setCookieHeader).toContain('HttpOnly');
    expect(setCookieHeader).toContain('Secure');
    expect(setCookieHeader).toContain('SameSite=Lax');
  });
});
