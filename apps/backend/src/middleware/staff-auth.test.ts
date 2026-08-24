import {afterEach, describe, expect, it} from 'bun:test';
import {Hono} from 'hono';
import {sign} from 'hono/jwt';
import {
  requireGeneralStaff,
  requireStaffForTournament,
  STAFF_SESSION_COOKIE,
} from './staff-auth';
import type {Bindings, StaffEnv} from '../types/env';

const SESSION_SECRET = 'test-session-secret';
const ENV: Bindings = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET,
};

const REGION_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_REGION_ID = '22222222-2222-2222-2222-222222222222';
const STAFF_ID = '33333333-3333-3333-3333-333333333333';

async function tokenFor(claims: Record<string, unknown>): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return sign({...claims, exp}, SESSION_SECRET);
}

function cookieHeader(token: string): {Cookie: string} {
  return {Cookie: `${STAFF_SESSION_COOKIE}=${token}`};
}

function mockTournamentFetch(
  row: {region_id: string; type: string} | null,
): void {
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json(row ? [row] : []),
    )) as unknown as typeof fetch;
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
});

describe('requireGeneralStaff', () => {
  const app = new Hono<StaffEnv>().get('/x', requireGeneralStaff(), c =>
    c.json({staff: c.get('staff')}),
  );

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
});
