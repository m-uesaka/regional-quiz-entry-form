import {afterEach, describe, expect, it} from 'bun:test';
import {verify} from 'hono/jwt';
import {participantAuthRoute} from './participant-auth';
import {hashPassword} from '../lib/password';
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

const PARTICIPANT_ID = '44444444-4444-4444-4444-444444444444';

function mockParticipantFetch(row: Record<string, unknown> | null): void {
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json(row ? [row] : []),
    )) as unknown as typeof fetch;
}

describe('POST /login', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('succeeds with correct credentials and sets a JWT cookie signed with SESSION_SECRET', async () => {
    const passwordChangedAt = '2026-08-25T01:23:45.678+00:00';
    mockParticipantFetch({
      id: PARTICIPANT_ID,
      password_hash: await hashPassword('correct-password'),
      password_changed_at: passwordChangedAt,
    });

    const res = await participantAuthRoute.request(
      '/login',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          email: 'participant@example.com',
          password: 'correct-password',
        }),
      },
      ENV,
    );

    expect(res.status).toBe(200);

    const setCookieHeader = res.headers.get('set-cookie') ?? '';
    expect(setCookieHeader).toContain('participant_session=');
    expect(setCookieHeader).toContain('HttpOnly');
    expect(setCookieHeader).toContain('Path=/');

    const token = setCookieHeader
      .split('participant_session=')[1]
      .split(';')[0];
    const verifiedPayload = await verify(token, ENV.SESSION_SECRET, 'HS256');
    // `pwdChangedAt` is what lets a later password reset cut this session:
    // `requireParticipant()` refuses it once the column no longer matches.
    expect(verifiedPayload).toMatchObject({
      sub: PARTICIPANT_ID,
      pwdChangedAt: Date.parse(passwordChangedAt),
    });
  });

  it('returns 401 for a wrong password', async () => {
    mockParticipantFetch({
      id: PARTICIPANT_ID,
      password_hash: await hashPassword('correct-password'),
    });

    const res = await participantAuthRoute.request(
      '/login',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          email: 'participant@example.com',
          password: 'wrong-password',
        }),
      },
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it('returns 401 for a non-existent email', async () => {
    mockParticipantFetch(null);

    const res = await participantAuthRoute.request(
      '/login',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          email: 'unknown@example.com',
          password: 'anything',
        }),
      },
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it('returns 429 with Retry-After when the rate limiter refuses', async () => {
    // The account is a valid one: a refused attempt must cost no PBKDF2
    // work at all, which is half of what this limit is for.
    mockParticipantFetch({
      id: PARTICIPANT_ID,
      password_hash: await hashPassword('correct-password'),
      password_changed_at: '2026-08-25T01:23:45.678+00:00',
    });

    const res = await participantAuthRoute.request(
      '/login',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          email: 'participant@example.com',
          password: 'correct-password',
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
    // A participant and a staff member can hold the same address. Without
    // the endpoint in the key the two logins would share one bucket, and
    // this cheap unauthenticated endpoint could be used to spend a staff
    // member's budget for that address.
    mockParticipantFetch(null);
    const keys: string[] = [];
    const recording: RateLimit = {
      limit: ({key}) => {
        keys.push(key ?? '');
        return Promise.resolve({success: true});
      },
    };

    await participantAuthRoute.request(
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

    // Folded, so that re-spelling the address doesn't hand out a second
    // budget for the same account.
    expect(keys).toEqual(['participant-login:email:shared@example.com']);
  });
});

/**
 * The attributes of a `Set-Cookie` header, lowercased and without the
 * `name=value` pair, `Max-Age` or `Expires` -- the three that necessarily
 * differ between issuing a cookie and deleting it. What is left is exactly
 * what a browser matches a deletion against.
 * @param header The raw `Set-Cookie` header value.
 */
function cookieAttributes(header: string): string[] {
  return header
    .split(';')
    .slice(1)
    .map(attribute => attribute.trim().toLowerCase())
    .filter(
      attribute =>
        !attribute.startsWith('max-age=') && !attribute.startsWith('expires='),
    )
    .sort();
}

/** Logs out, optionally carrying the session cookie a browser would hold. */
async function logout(sessionCookie?: string): Promise<Response> {
  return participantAuthRoute.request(
    '/logout',
    {
      method: 'POST',
      headers: sessionCookie
        ? {cookie: `participant_session=${sessionCookie}`}
        : {},
    },
    ENV,
  );
}

describe('POST /logout', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** Logs in and returns the `Set-Cookie` header the login answered with. */
  async function loginSetCookie(): Promise<string> {
    mockParticipantFetch({
      id: PARTICIPANT_ID,
      password_hash: await hashPassword('correct-password'),
      password_changed_at: '2026-08-25T01:23:45.678+00:00',
    });

    const res = await participantAuthRoute.request(
      '/login',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          email: 'participant@example.com',
          password: 'correct-password',
        }),
      },
      ENV,
    );
    return res.headers.get('set-cookie') ?? '';
  }

  it('clears the session cookie', async () => {
    const token = (await loginSetCookie())
      .split('participant_session=')[1]
      .split(';')[0];

    const res = await logout(token);

    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toEqual({
      ok: true,
    });

    const setCookieHeader = res.headers.get('set-cookie') ?? '';
    // An empty value plus `Max-Age=0` is what tells the browser to drop the
    // cookie it is holding, rather than to store this one.
    expect(setCookieHeader).toContain('participant_session=;');
    expect(setCookieHeader).toContain('Max-Age=0');
  });

  it('succeeds without a session', async () => {
    // Nothing to clear, and nothing to complain about: a second logout, or
    // one from a browser whose cookie already expired, still lands here.
    const res = await logout();

    expect(res.status).toBe(200);
    expect((await res.json()) as Record<string, unknown>).toEqual({
      ok: true,
    });
    expect(res.headers.get('set-cookie') ?? '').toContain(
      'participant_session=;',
    );
  });

  it('deletes with the same attributes login set', async () => {
    const issued = await loginSetCookie();

    const deleted = (await logout()).headers.get('set-cookie') ?? '';

    // A deletion whose `Path`, `Secure` or `SameSite` differs from the
    // issued cookie's addresses a different cookie, and the session would
    // survive the logout.
    expect(cookieAttributes(deleted)).toEqual(cookieAttributes(issued));
  });
});
