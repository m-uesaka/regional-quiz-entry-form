import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {Hono} from 'hono';
import {sign} from 'hono/jwt';
import {
  requireGeneralStaff,
  requireStaffForEntry,
  requireStaffForTournament,
  STAFF_SESSION_COOKIE,
} from './staff-auth';
import type {Bindings, StaffEnv} from '../types/env';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';
import {
  staffSessionAwareFetch,
  TEST_SESSIONS_VALID_FROM,
  TEST_SESSIONS_VALID_FROM_MS,
} from '../test-support/staff-session';

const SESSION_SECRET = 'test-session-secret';
const ENV: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET,
};

const REGION_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_REGION_ID = '22222222-2222-2222-2222-222222222222';
const STAFF_ID = '33333333-3333-3333-3333-333333333333';

// A later generation than the one the test tokens carry: what the row says
// once the account's sessions have been revoked.
const REVOKED_AT = '2026-08-25T02:00:00.000Z';

/**
 * A token for `claims`, issued for the generation the session-check stub
 * reports unless the claims say otherwise.
 */
async function tokenFor(claims: Record<string, unknown>): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return sign(
    {sessionsValidFrom: TEST_SESSIONS_VALID_FROM_MS, ...claims, exp},
    SESSION_SECRET,
  );
}

/** Makes every Supabase call fail, as a database outage would. */
function mockFailingFetch(): void {
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({message: 'connection refused'}, {status: 500}),
    )) as unknown as typeof fetch;
}

/** Runs `body` with `console.error` silenced, for the expected 500s. */
async function withoutErrorLog(body: () => Promise<void>): Promise<void> {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await body();
  } finally {
    console.error = originalConsoleError;
  }
}

function cookieHeader(token: string): {Cookie: string} {
  return {Cookie: `${STAFF_SESSION_COOKIE}=${token}`};
}

function mockTournamentFetch(
  row: {region_id: string; type: string} | null,
  sessionsValidFrom: string | null = TEST_SESSIONS_VALID_FROM,
): void {
  globalThis.fetch = staffSessionAwareFetch(
    (() =>
      Promise.resolve(
        Response.json(row ? [row] : []),
      )) as unknown as typeof fetch,
    sessionsValidFrom,
  );
}

describe('requireStaffForTournament', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const app = new Hono<StaffEnv>().get(
    '/tournaments/:tournamentId/x',
    requireStaffForTournament(),
    c => c.json({staff: c.get('staff')}),
  );

  it('allows regional staff for their own region and type', async () => {
    mockTournamentFetch({region_id: REGION_ID, type: 'saikyoi'});
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    const res = await app.request(
      '/tournaments/t1/x',
      {headers: cookieHeader(token)},
      ENV,
    );

    expect(res.status).toBe(200);
  });

  it('rejects regional staff for a different region', async () => {
    mockTournamentFetch({region_id: OTHER_REGION_ID, type: 'saikyoi'});
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    const res = await app.request(
      '/tournaments/t1/x',
      {headers: cookieHeader(token)},
      ENV,
    );

    expect(res.status).toBe(403);
  });

  it('rejects regional staff for a different tournament type in the same region', async () => {
    mockTournamentFetch({region_id: REGION_ID, type: 'shinjinou'});
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    const res = await app.request(
      '/tournaments/t1/x',
      {headers: cookieHeader(token)},
      ENV,
    );

    expect(res.status).toBe(403);
  });

  it('allows general staff for any tournament', async () => {
    mockTournamentFetch(null);
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'general',
      regionId: null,
      tournamentType: null,
    });

    const res = await app.request(
      '/tournaments/t1/x',
      {headers: cookieHeader(token)},
      ENV,
    );

    expect(res.status).toBe(200);
  });

  it('returns 401 for a malformed token', async () => {
    const res = await app.request(
      '/tournaments/t1/x',
      {headers: cookieHeader('not-a-real-token')},
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    const token = await sign(
      {
        sub: STAFF_ID,
        role: 'general',
        regionId: null,
        tournamentType: null,
        exp: Math.floor(Date.now() / 1000) - 3600,
      },
      SESSION_SECRET,
    );

    const res = await app.request(
      '/tournaments/t1/x',
      {headers: cookieHeader(token)},
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it('returns 401 for a token with a tampered signature', async () => {
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'general',
      regionId: null,
      tournamentType: null,
    });
    // Flip the *first* character of the signature segment rather than the
    // token's last character: base64url's final character of a 32-byte
    // HMAC signature only encodes 4 significant bits (the other 2 are
    // unused padding), so toggling it there sometimes decodes to the same
    // signature bytes and the token verifies as valid anyway (flaky).
    const [header, payload, signature] = token.split('.');
    const tamperedSignature =
      (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    const tampered = `${header}.${payload}.${tamperedSignature}`;

    const res = await app.request(
      '/tournaments/t1/x',
      {headers: cookieHeader(tampered)},
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it('requireStaffForTournament rejects a revoked session', async () => {
    // In scope, correctly signed, unexpired -- and issued before the
    // account's sessions were revoked, which is the only thing wrong with it.
    mockTournamentFetch({region_id: REGION_ID, type: 'saikyoi'}, REVOKED_AT);
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    const res = await app.request(
      '/tournaments/t1/x',
      {headers: cookieHeader(token)},
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it('answers a revoked out-of-scope session with 401, not 403', async () => {
    mockTournamentFetch(
      {region_id: 'other-region', type: 'saikyoi'},
      REVOKED_AT,
    );
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    const res = await app.request(
      '/tournaments/t1/x',
      {headers: cookieHeader(token)},
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it('reads the session and the scope concurrently', async () => {
    // Neither read waits for the other: both are in flight before either
    // answers.
    let inFlight = 0;
    let maxInFlight = 0;
    const respond = staffSessionAwareFetch((() =>
      Promise.resolve(
        Response.json([{region_id: REGION_ID, type: 'saikyoi'}]),
      )) as unknown as typeof fetch);
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight -= 1;
      return respond(input, init);
    }) as unknown as typeof fetch;
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    const res = await app.request(
      '/tournaments/t1/x',
      {headers: cookieHeader(token)},
      ENV,
    );

    expect(res.status).toBe(200);
    expect(maxInFlight).toBe(2);
  });

  it('rejects a revoked general staff session too', async () => {
    // General staff skip the tournament lookup, but not the session check.
    mockTournamentFetch(null, REVOKED_AT);
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'general',
      regionId: null,
      tournamentType: null,
    });

    const res = await app.request(
      '/tournaments/t1/x',
      {headers: cookieHeader(token)},
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it('the middleware answers 500, not 401, when the revocation check cannot be read', async () => {
    mockFailingFetch();
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'general',
      regionId: null,
      tournamentType: null,
    });

    await withoutErrorLog(async () => {
      const res = await app.request(
        '/tournaments/t1/x',
        {headers: cookieHeader(token)},
        ENV,
      );

      // A database outage must not read as "your session is invalid" and
      // send staff back to the login screen.
      expect(res.status).toBe(500);
    });
  });

  it('the middleware rejects a session whose staff account no longer exists', async () => {
    mockTournamentFetch({region_id: REGION_ID, type: 'saikyoi'}, null);
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    const res = await app.request(
      '/tournaments/t1/x',
      {headers: cookieHeader(token)},
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it('accepts a session whose timestamp Postgres formats differently', async () => {
    // PostgREST renders `timestamptz` with a `+00:00` offset rather than `Z`;
    // the claim is compared as epoch milliseconds so both spell one instant.
    mockTournamentFetch(null, '2026-08-25T01:23:45.678+00:00');
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'general',
      regionId: null,
      tournamentType: null,
    });

    const res = await app.request(
      '/tournaments/t1/x',
      {headers: cookieHeader(token)},
      ENV,
    );

    expect(res.status).toBe(200);
  });
});

function mockEntryTournamentFetch(
  row: {region_id: string; type: string} | null,
  sessionsValidFrom: string | null = TEST_SESSIONS_VALID_FROM,
): void {
  globalThis.fetch = staffSessionAwareFetch(
    (() =>
      Promise.resolve(
        Response.json(row ? [{tournaments: row}] : []),
      )) as unknown as typeof fetch,
    sessionsValidFrom,
  );
}

describe('requireStaffForEntry', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const app = new Hono<StaffEnv>().get(
    '/entries/:entryId/x',
    requireStaffForEntry(),
    c => c.json({staff: c.get('staff')}),
  );

  it('allows regional staff for their own region and type', async () => {
    mockEntryTournamentFetch({region_id: REGION_ID, type: 'saikyoi'});
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    const res = await app.request(
      '/entries/e1/x',
      {headers: cookieHeader(token)},
      ENV,
    );

    expect(res.status).toBe(200);
  });

  it('rejects regional staff for a different region', async () => {
    mockEntryTournamentFetch({region_id: OTHER_REGION_ID, type: 'saikyoi'});
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    const res = await app.request(
      '/entries/e1/x',
      {headers: cookieHeader(token)},
      ENV,
    );

    expect(res.status).toBe(403);
  });

  it('rejects regional staff when the entry does not exist', async () => {
    mockEntryTournamentFetch(null);
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    const res = await app.request(
      '/entries/e1/x',
      {headers: cookieHeader(token)},
      ENV,
    );

    expect(res.status).toBe(403);
  });

  it('allows general staff for any entry', async () => {
    mockEntryTournamentFetch(null);
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'general',
      regionId: null,
      tournamentType: null,
    });

    const res = await app.request(
      '/entries/e1/x',
      {headers: cookieHeader(token)},
      ENV,
    );

    expect(res.status).toBe(200);
  });

  it('returns 401 for a malformed token', async () => {
    const res = await app.request(
      '/entries/e1/x',
      {headers: cookieHeader('not-a-real-token')},
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it('rejects a revoked session', async () => {
    mockEntryTournamentFetch(
      {region_id: REGION_ID, type: 'saikyoi'},
      REVOKED_AT,
    );
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    const res = await app.request(
      '/entries/e1/x',
      {headers: cookieHeader(token)},
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it('answers 500 when the revocation check cannot be read', async () => {
    mockFailingFetch();
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    await withoutErrorLog(async () => {
      const res = await app.request(
        '/entries/e1/x',
        {headers: cookieHeader(token)},
        ENV,
      );

      expect(res.status).toBe(500);
    });
  });
});

describe('requireGeneralStaff', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = staffSessionAwareFetch(originalFetch);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const app = new Hono<StaffEnv>().get('/x', requireGeneralStaff(), c =>
    c.json({staff: c.get('staff')}),
  );

  const generalClaims = {
    sub: STAFF_ID,
    role: 'general',
    regionId: null,
    tournamentType: null,
  };

  it('rejects a valid token whose role is "regional"', async () => {
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(403);
  });

  it('allows a valid token whose role is "general"', async () => {
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'general',
      regionId: null,
      tournamentType: null,
    });

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(200);
  });

  it('rejects a validly signed token with no exp claim', async () => {
    const token = await sign(
      {
        sub: STAFF_ID,
        role: 'general',
        regionId: null,
        tournamentType: null,
      },
      SESSION_SECRET,
    );

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(401);
  });

  it('requireGeneralStaff rejects a session issued before sessions_valid_from moved', async () => {
    globalThis.fetch = staffSessionAwareFetch(originalFetch, REVOKED_AT);
    const token = await tokenFor(generalClaims);

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    // The whole point of the column: a cookie copied before the revocation
    // stops working on the next request, not when it expires 12 hours later.
    expect(res.status).toBe(401);
  });

  it('accepts a session issued after sessions_valid_from moved', async () => {
    // The owner logging back in after a revocation gets a session of the new
    // generation, which the same row now accepts.
    globalThis.fetch = staffSessionAwareFetch(originalFetch, REVOKED_AT);
    const token = await tokenFor({
      ...generalClaims,
      sessionsValidFrom: Date.parse(REVOKED_AT),
    });

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(200);
  });

  it('answers 500, not 401, when the revocation check cannot be read', async () => {
    mockFailingFetch();
    const token = await tokenFor(generalClaims);

    await withoutErrorLog(async () => {
      const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

      expect(res.status).toBe(500);
    });
  });

  it('rejects a session whose staff account no longer exists', async () => {
    globalThis.fetch = staffSessionAwareFetch(originalFetch, null);
    const token = await tokenFor(generalClaims);

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(401);
  });

  it('rejects a token issued before sessionsValidFrom existed', async () => {
    // A cookie from before this claim was added can't be shown to be
    // current, so it reads as logged out rather than as a working session.
    const token = await sign(
      {...generalClaims, exp: Math.floor(Date.now() / 1000) + 3600},
      SESSION_SECRET,
    );

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(401);
  });

  it('refuses regional staff with 403', async () => {
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(403);
  });

  it('answers a revoked regional session with 401, not 403', async () => {
    // The role alone would refuse it, but a dead session is answered as one
    // so the staff screens send its holder back to the login form.
    globalThis.fetch = staffSessionAwareFetch(originalFetch, REVOKED_AT);
    const token = await tokenFor({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(401);
  });
});
