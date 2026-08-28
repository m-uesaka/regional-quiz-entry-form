import {afterEach, describe, expect, it} from 'bun:test';
import {sign} from 'hono/jwt';
import type {Bindings} from '../types/env';
import app from '../index';
import {PERMISSIVE_SECURITY_BINDINGS} from '../test-support/bindings';

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

const TOKYO_REGION_ID = '11111111-1111-1111-1111-111111111111';
const OSAKA_REGION_ID = '22222222-2222-2222-2222-222222222222';
const TOKYO_TOURNAMENT_ID = '33333333-3333-3333-3333-333333333333';
const OSAKA_TOURNAMENT_ID = '44444444-4444-4444-4444-444444444444';

async function regionalStaffCookie(): Promise<string> {
  const token = await sign(
    {
      sub: '88888888-8888-8888-8888-888888888888',
      role: 'regional',
      regionId: TOKYO_REGION_ID,
      tournamentType: 'saikyoi',
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    ENV.SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

async function generalStaffCookie(): Promise<string> {
  const token = await sign(
    {
      sub: '99999999-9999-9999-9999-999999999999',
      role: 'general',
      regionId: null,
      tournamentType: null,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    ENV.SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

// Two regions' worth of rows, as `tournament_entry_summary()` returns them.
// The Osaka row is the "nobody has entered yet, no capacity set" case.
const SUMMARY_ROWS = [
  {
    tournament_id: TOKYO_TOURNAMENT_ID,
    tournament_name: '東京大会',
    tournament_type: 'saikyoi',
    region_id: TOKYO_REGION_ID,
    region_slug: 'tokyo',
    region_name: '東京',
    capacity: 100,
    confirmed_count: 80,
    waitlisted_count: 12,
    pending_verification_count: 3,
    cancelled_count: 5,
  },
  {
    tournament_id: OSAKA_TOURNAMENT_ID,
    tournament_name: '大阪大会',
    tournament_type: 'shinjinou',
    region_id: OSAKA_REGION_ID,
    region_slug: 'osaka',
    region_name: '大阪',
    capacity: null,
    confirmed_count: 0,
    waitlisted_count: 0,
    pending_verification_count: 0,
    cancelled_count: 0,
  },
];

/**
 * Mocks the single `fetch` Supabase's REST client makes for the RPC call,
 * answering it with `body`. `requireGeneralStaff()` reads the session from
 * the cookie alone, so unlike the tournament-scoped staff routes there is
 * no preceding scope lookup to mock.
 */
function mockFetch(body: unknown | Response): {urls: string[]} {
  const urls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    urls.push(typeof input === 'string' ? input : input.toString());
    return Promise.resolve(
      body instanceof Response ? body : Response.json(body),
    );
  }) as unknown as typeof fetch;
  return {urls};
}

describe('GET /staff/dashboard', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns 401 without a staff session', async () => {
    const res = await app.request('/api/staff/dashboard', {}, ENV);

    expect(res.status).toBe(401);
  });

  it('rejects regional staff', async () => {
    const cookie = await regionalStaffCookie();

    const res = await app.request(
      '/api/staff/dashboard',
      {headers: {cookie}},
      ENV,
    );

    expect(res.status).toBe(403);
  });

  it('returns summary rows across all regions', async () => {
    const log = mockFetch(SUMMARY_ROWS);
    const cookie = await generalStaffCookie();

    const res = await app.request(
      '/api/staff/dashboard',
      {headers: {cookie}},
      ENV,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(log.urls[0]).toContain('/rest/v1/rpc/tournament_entry_summary');
    expect(body).toEqual([
      {
        tournamentId: TOKYO_TOURNAMENT_ID,
        tournamentName: '東京大会',
        tournamentType: 'saikyoi',
        regionId: TOKYO_REGION_ID,
        regionSlug: 'tokyo',
        regionName: '東京',
        capacity: 100,
        confirmedCount: 80,
        waitlistedCount: 12,
        pendingVerificationCount: 3,
        cancelledCount: 5,
      },
      {
        tournamentId: OSAKA_TOURNAMENT_ID,
        tournamentName: '大阪大会',
        tournamentType: 'shinjinou',
        regionId: OSAKA_REGION_ID,
        regionSlug: 'osaka',
        regionName: '大阪',
        capacity: null,
        confirmedCount: 0,
        waitlistedCount: 0,
        pendingVerificationCount: 0,
        cancelledCount: 0,
      },
    ]);
  });

  it('returns an empty list when no tournament exists yet', async () => {
    mockFetch([]);
    const cookie = await generalStaffCookie();

    const res = await app.request(
      '/api/staff/dashboard',
      {headers: {cookie}},
      ENV,
    );

    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  it('returns 500 when the aggregation query fails', async () => {
    mockFetch(Response.json({message: 'db is down'}, {status: 500}));
    const cookie = await generalStaffCookie();

    const res = await app.request(
      '/api/staff/dashboard',
      {headers: {cookie}},
      ENV,
    );

    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({error: 'internal server error'});
  });
});
