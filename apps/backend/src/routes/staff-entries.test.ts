import {afterEach, describe, expect, it} from 'bun:test';
import {sign} from 'hono/jwt';
import type {Bindings} from '../types/env';
import app from '../index';

const ENV: Bindings = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

const REGION_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_REGION_ID = '22222222-2222-2222-2222-222222222222';
const TOURNAMENT_ID = '44444444-4444-4444-4444-444444444444';
const ENTRY_ID = '55555555-5555-5555-5555-555555555555';

async function regionalStaffCookie(
  regionId = REGION_ID,
  tournamentType = 'saikyoi',
): Promise<string> {
  const token = await sign(
    {
      sub: '88888888-8888-8888-8888-888888888888',
      role: 'regional',
      regionId,
      tournamentType,
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

const FULL_ENTRY_ROW = {
  id: ENTRY_ID,
  tournament_id: TOURNAMENT_ID,
  name: '山田太郎',
  furigana: 'ヤマダタロウ',
  display_name: '太郎',
  regulation_id: '66666666-6666-6666-6666-666666666666',
  free_text: '自由記述',
  custom_field_values: {},
  status: 'pending_verification',
  waitlist_position: null,
};

/**
 * Mocks the sequence of `fetch` calls Supabase's REST client makes,
 * returning each `responses` entry's body in order (one per call). A
 * scope-checked request under `requireStaffForTournament()` /
 * `requireStaffForEntry()` makes one call for the scope lookup followed by
 * one for the route handler's own query; general staff skip the scope
 * lookup and only trigger the second.
 */
function mockSequentialFetch(responses: unknown[]): void {
  let callIndex = 0;
  globalThis.fetch = (() => {
    const body = responses[callIndex] ?? [];
    callIndex++;
    return Promise.resolve(Response.json(body));
  }) as unknown as typeof fetch;
}

describe('staff-entries routes (request validation)', () => {
  it('GET /staff/tournaments/:id/entries returns 401 without a staff session', async () => {
    const res = await app.request(
      `/api/staff/tournaments/${TOURNAMENT_ID}/entries`,
      {},
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it('GET /staff/entries/:id returns 401 without a staff session', async () => {
    const res = await app.request(`/api/staff/entries/${ENTRY_ID}`, {}, ENV);

    expect(res.status).toBe(401);
  });
});

describe('GET /staff/tournaments/:id/entries (mocked Supabase)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns full entry data for authorized staff', async () => {
    mockSequentialFetch([
      [{region_id: REGION_ID, type: 'saikyoi'}],
      [FULL_ENTRY_ROW],
    ]);
    const cookie = await regionalStaffCookie();

    const res = await app.request(
      `/api/staff/tournaments/${TOURNAMENT_ID}/entries`,
      {headers: {cookie}},
      ENV,
    );
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: ENTRY_ID,
      name: '山田太郎',
      furigana: 'ヤマダタロウ',
      displayName: '太郎',
      freeText: '自由記述',
      status: 'pending_verification',
    });
  });

  it('returns 403 for staff of a different region', async () => {
    mockSequentialFetch([[{region_id: OTHER_REGION_ID, type: 'saikyoi'}]]);
    const cookie = await regionalStaffCookie(REGION_ID);

    const res = await app.request(
      `/api/staff/tournaments/${TOURNAMENT_ID}/entries`,
      {headers: {cookie}},
      ENV,
    );

    expect(res.status).toBe(403);
  });

  it('allows general staff for any tournament', async () => {
    mockSequentialFetch([[FULL_ENTRY_ROW]]);
    const cookie = await generalStaffCookie();

    const res = await app.request(
      `/api/staff/tournaments/${TOURNAMENT_ID}/entries`,
      {headers: {cookie}},
      ENV,
    );

    expect(res.status).toBe(200);
  });
});

describe('GET /staff/entries/:id (mocked Supabase)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns full entry data for authorized staff', async () => {
    mockSequentialFetch([
      [{tournaments: {region_id: REGION_ID, type: 'saikyoi'}}],
      [FULL_ENTRY_ROW],
    ]);
    const cookie = await regionalStaffCookie();

    const res = await app.request(
      `/api/staff/entries/${ENTRY_ID}`,
      {headers: {cookie}},
      ENV,
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: ENTRY_ID,
      name: '山田太郎',
      furigana: 'ヤマダタロウ',
    });
  });

  it('returns 403 for staff of a different region', async () => {
    mockSequentialFetch([
      [{tournaments: {region_id: OTHER_REGION_ID, type: 'saikyoi'}}],
    ]);
    const cookie = await regionalStaffCookie(REGION_ID);

    const res = await app.request(
      `/api/staff/entries/${ENTRY_ID}`,
      {headers: {cookie}},
      ENV,
    );

    expect(res.status).toBe(403);
  });

  it('returns 404 when the entry does not exist', async () => {
    mockSequentialFetch([[]]);
    const cookie = await generalStaffCookie();

    const res = await app.request(
      `/api/staff/entries/${ENTRY_ID}`,
      {headers: {cookie}},
      ENV,
    );

    expect(res.status).toBe(404);
  });
});
