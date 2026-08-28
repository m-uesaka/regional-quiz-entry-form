import {afterEach, describe, expect, it} from 'bun:test';
import {Hono} from 'hono';
import {sign} from 'hono/jwt';
import {
  requireParticipant,
  PARTICIPANT_SESSION_COOKIE,
} from './participant-auth';
import type {Bindings, ParticipantEnv} from '../types/env';
import {PERMISSIVE_SECURITY_BINDINGS} from '../test-support/bindings';

const SESSION_SECRET = 'test-session-secret';
const ENV: Bindings = {
  ...PERMISSIVE_SECURITY_BINDINGS,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET,
};

const PARTICIPANT_ID = '44444444-4444-4444-4444-444444444444';

const NOW_SECONDS = Math.floor(Date.now() / 1000);

// The `participants.password_changed_at` these tests hand back, and the value
// a session issued for it carries. Deliberately not a whole second, so a
// comparison that truncated either side would show up as a failure.
const PASSWORD_CHANGED_AT = '2026-08-25T01:23:45.678Z';
const PASSWORD_CHANGED_AT_MS = Date.parse(PASSWORD_CHANGED_AT);

/** Answers the middleware's `participants` lookup with `rows`. */
function mockParticipantRows(rows: Record<string, unknown>[]): void {
  globalThis.fetch = (() =>
    Promise.resolve(Response.json(rows))) as unknown as typeof fetch;
}

/** Answers that lookup with a participant whose password changed at `at`. */
function mockPasswordChangedAt(at: string): void {
  mockParticipantRows([{password_changed_at: at}]);
}

async function tokenFor(claims: Record<string, unknown>): Promise<string> {
  const exp = NOW_SECONDS + 3600;
  return sign({...claims, exp}, SESSION_SECRET);
}

/** A session issued for the password recorded at `PASSWORD_CHANGED_AT`. */
async function currentSessionToken(): Promise<string> {
  return tokenFor({sub: PARTICIPANT_ID, pwdChangedAt: PASSWORD_CHANGED_AT_MS});
}

function cookieHeader(token: string): {Cookie: string} {
  return {Cookie: `${PARTICIPANT_SESSION_COOKIE}=${token}`};
}

describe('requireParticipant', () => {
  const originalFetch = globalThis.fetch;
  const app = new Hono<ParticipantEnv>().get('/x', requireParticipant(), c =>
    c.json({participantId: c.get('participantId')}),
  );

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sets participantId from a valid token', async () => {
    mockPasswordChangedAt(PASSWORD_CHANGED_AT);
    const token = await currentSessionToken();

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({participantId: PARTICIPANT_ID});
  });

  it('returns 401 when the cookie is missing', async () => {
    const res = await app.request('/x', {}, ENV);

    expect(res.status).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    mockPasswordChangedAt(PASSWORD_CHANGED_AT);
    const token = await sign(
      {
        sub: PARTICIPANT_ID,
        pwdChangedAt: PASSWORD_CHANGED_AT_MS,
        exp: NOW_SECONDS - 3600,
      },
      SESSION_SECRET,
    );

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(401);
  });

  it('returns 401 for a tampered token', async () => {
    mockPasswordChangedAt(PASSWORD_CHANGED_AT);
    const token = await currentSessionToken();
    // Flip the *first* character of the signature segment rather than the
    // token's last character: base64url's final character of a 32-byte
    // HMAC signature only encodes 4 significant bits (the other 2 are
    // unused padding), so toggling it there sometimes decodes to the same
    // signature bytes and the token verifies as valid anyway (flaky).
    const [header, payload, signature] = token.split('.');
    const tamperedSignature =
      (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    const tampered = `${header}.${payload}.${tamperedSignature}`;

    const res = await app.request('/x', {headers: cookieHeader(tampered)}, ENV);

    expect(res.status).toBe(401);
  });

  it('returns 401 for a validly signed token with no exp claim', async () => {
    mockPasswordChangedAt(PASSWORD_CHANGED_AT);
    const token = await sign(
      {sub: PARTICIPANT_ID, pwdChangedAt: PASSWORD_CHANGED_AT_MS},
      SESSION_SECRET,
    );

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(401);
  });

  it('returns 401 for a validly signed token with no pwdChangedAt claim', async () => {
    mockPasswordChangedAt(PASSWORD_CHANGED_AT);
    // Without the claim there is nothing to check `password_changed_at`
    // against, so such a session can't be shown to be current and has to be
    // refused.
    const token = await tokenFor({sub: PARTICIPANT_ID});

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(401);
  });

  it('returns 401 for a session issued before the password was reset', async () => {
    // The row now carries a later `password_changed_at` than the session does.
    mockPasswordChangedAt('2026-08-25T02:00:00.000Z');
    const token = await currentSessionToken();

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    // The whole point of the check: a cookie stolen before the reset must
    // stop working the moment the participant resets their password, not
    // when it happens to expire a week later.
    expect(res.status).toBe(401);
  });

  it('accepts a session whose timestamp Postgres formats differently', async () => {
    // PostgREST renders `timestamptz` with a `+00:00` offset rather than `Z`.
    // The claim is compared as epoch milliseconds precisely so the two spell
    // the same instant the same way.
    mockPasswordChangedAt('2026-08-25T01:23:45.678+00:00');
    const token = await currentSessionToken();

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(200);
  });

  it('returns 401 when the participant no longer exists', async () => {
    mockParticipantRows([]);
    const token = await currentSessionToken();

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(401);
  });

  it('returns 500 rather than 401 when the lookup fails', async () => {
    const originalConsoleError = console.error;
    console.error = () => {};
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({message: 'connection refused'}, {status: 500}),
      )) as unknown as typeof fetch;
    const token = await currentSessionToken();

    try {
      const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

      // A database outage must not read as "your session is invalid" and send
      // the participant back to the login screen.
      expect(res.status).toBe(500);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
