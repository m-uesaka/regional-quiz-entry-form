import {afterEach, describe, expect, it} from 'bun:test';
import {staffAuthRoute} from './staff-auth';
import {
  hashPassword,
  UNUSABLE_PASSWORD_HASH,
  verifyPassword,
} from '../lib/password';
import type {Bindings} from '../types/env';
import {
  PERMISSIVE_PLATFORM_BINDINGS,
  refusingRateLimiter,
} from '../test-support/bindings';
import {
  collectingExecutionContext,
  legacyHashPassword,
  mockAccountFetchWithRehash,
} from '../test-support/password';

const ENV: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

const STAFF_ID = '33333333-3333-3333-3333-333333333333';
const REGION_ID = '11111111-1111-1111-1111-111111111111';
const REGION_SLUG = 'tokyo';
// What the account's `sessions_valid_from` reads as. PostgREST spells
// `timestamptz` with an offset, and the claim has to come out as the same
// instant regardless.
const SESSIONS_VALID_FROM = '2026-08-25T01:23:45.678+00:00';

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
    sessions_valid_from: SESSIONS_VALID_FROM,
    regions: {slug: REGION_SLUG},
  };
}

/**
 * Answers every read with `row`, and records the URLs the login asked for
 * so a test can check which row it was looking for.
 * @param row The account the lookup finds, or `null` for none.
 */
function mockStaffAccountFetch(row: Record<string, unknown> | null): URL[] {
  const urls: URL[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    urls.push(new URL(input instanceof Request ? input.url : String(input)));
    return Promise.resolve(Response.json(row ? [row] : []));
  }) as unknown as typeof fetch;
  return urls;
}

/**
 * Posts a login request for the mocked account.
 * @param password The password to submit.
 * @param email The address to submit.
 * @param scope Which of the address's accounts to log in to.
 */
async function login(
  password: string,
  email = 'staff@example.com',
  scope = 'saikyoi',
): Promise<Response> {
  return staffAuthRoute.request(
    '/login',
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email, scope, password}),
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

  it("embeds the account's sessions_valid_from as sessionsValidFrom", async () => {
    // What the staff guards compare against the column on every request: a
    // session issued without it, or with a different instant, would be
    // refused as revoked from its very first request.
    mockStaffAccountFetch(
      regionalStaffRow(await hashPassword('correct-password')),
    );

    const res = await login('correct-password');

    const setCookieHeader = res.headers.get('set-cookie') ?? '';
    const token = setCookieHeader.split('staff_session=')[1].split(';')[0];
    expect(decodeJwtPayload(token).sessionsValidFrom).toBe(
      Date.parse('2026-08-25T01:23:45.678Z'),
    );
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
      sessions_valid_from: SESSIONS_VALID_FROM,
      regions: null,
    });

    const res = await login('correct-password', 'staff@example.com', 'general');

    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toEqual({
      ok: true,
      role: 'general',
      regionSlug: null,
      tournamentType: null,
    });
  });

  // #166: one address may hold a 最強位 and a 新人王 account, so the
  // lookup has to be narrowed by the type the login names.
  it('looks the account up by address and tournament type', async () => {
    const urls = mockStaffAccountFetch(
      regionalStaffRow(await hashPassword('correct-password')),
    );

    await login('correct-password', 'staff@example.com', 'shinjinou');

    expect(urls).toHaveLength(1);
    expect(urls[0].searchParams.get('email')).toBe('eq.staff@example.com');
    expect(urls[0].searchParams.get('tournament_type')).toBe('eq.shinjinou');
  });

  // General staff carry no tournament type, so `general` has to match the
  // null one rather than a type named `general`.
  it('looks a general account up by its null tournament type', async () => {
    const urls = mockStaffAccountFetch(null);

    await login('anything', 'staff@example.com', 'general');

    expect(urls[0].searchParams.get('tournament_type')).toBe('is.null');
  });

  // #156: a disabled account is not looked for at all, so it is refused the
  // same way as an address that was never registered.
  it('only looks for an account that is not disabled', async () => {
    const urls = mockStaffAccountFetch(null);

    await login('anything');

    expect(urls[0].searchParams.get('disabled_at')).toBe('is.null');
  });

  // #133: the account was stored lowercased, so the lookup must be too.
  it('lowercases the address before looking it up', async () => {
    const urls = mockStaffAccountFetch(null);

    await login('anything', 'Staff@Example.COM');

    expect(urls[0].searchParams.get('email')).toBe('eq.staff@example.com');
  });

  it('returns 400 without a scope', async () => {
    const urls = mockStaffAccountFetch(null);

    const res = await staffAuthRoute.request(
      '/login',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email: 'staff@example.com', password: 'x'}),
      },
      ENV,
    );

    expect(res.status).toBe(400);
    expect(urls).toHaveLength(0);
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
          scope: 'saikyoi',
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
          scope: 'saikyoi',
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

  describe('rehashing', () => {
    const originalConsoleError = console.error;

    afterEach(() => {
      console.error = originalConsoleError;
    });

    /** Logs in as the mocked staff member inside `ctx`. */
    async function loginWithContext(
      password: string,
      ctx: ExecutionContext,
    ): Promise<Response> {
      return staffAuthRoute.request(
        '/login',
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            email: 'staff@example.com',
            scope: 'saikyoi',
            password,
          }),
        },
        ENV,
        ctx,
      );
    }

    it('login rehashes a legacy password and still succeeds', async () => {
      const legacyHash = await legacyHashPassword('correct-password');
      const updates = mockAccountFetchWithRehash(regionalStaffRow(legacyHash));
      const {ctx, settle} = collectingExecutionContext();

      const res = await loginWithContext('correct-password', ctx);
      await settle();

      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie') ?? '').toContain('staff_session=');
      expect(updates.length).toBe(1);
      const [update] = updates;
      expect(update.table).toBe('staff_accounts');
      expect(update.filters.get('id')).toBe(`eq.${STAFF_ID}`);
      // Conditional on the old hash, so a reset that lands in between is not
      // overwritten with the old password.
      expect(update.filters.get('password_hash')).toBe(`eq.${legacyHash}`);
      expect(
        await verifyPassword('correct-password', update.passwordHash),
      ).toEqual({valid: true, needsRehash: false});
    });

    it('login still succeeds when the rehash fails', async () => {
      const errors: unknown[][] = [];
      console.error = (...args: unknown[]) => {
        errors.push(args);
      };
      const updates = mockAccountFetchWithRehash(
        regionalStaffRow(await legacyHashPassword('correct-password')),
        {failUpdate: true},
      );
      const {ctx, settle} = collectingExecutionContext();

      const res = await loginWithContext('correct-password', ctx);
      await settle();

      expect(res.status).toBe(200);
      expect(res.headers.get('set-cookie') ?? '').toContain('staff_session=');
      expect(updates.length).toBe(1);
      expect(errors.length).toBe(1);
      expect(errors[0][0]).toBe('failed to rehash a password');
    });

    it('login does not rewrite a hash already in the current format', async () => {
      const updates = mockAccountFetchWithRehash(
        regionalStaffRow(await hashPassword('correct-password')),
      );
      const {ctx, settle} = collectingExecutionContext();

      const res = await loginWithContext('correct-password', ctx);
      await settle();

      expect(res.status).toBe(200);
      expect(updates).toEqual([]);
    });
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
