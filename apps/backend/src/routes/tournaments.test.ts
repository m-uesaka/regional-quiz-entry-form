import {afterAll, afterEach, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import {sign} from 'hono/jwt';
import type {Bindings} from '../types/env';
import {app} from '../index';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';
import {
  closedEntryPeriodTournament,
  openEntryPeriodTournament,
  TEST_REGION_ID,
  tournamentAwareFetch,
} from '../test-support/tournaments';

// Local Supabase stack (`supabase start`), same convention as
// `lib/db-schema.test.ts`. Skipped automatically when it isn't reachable,
// e.g. in CI.
const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// Publicly documented local-dev demo key for Supabase CLI's default stack
// (fixed `super-secret-jwt-token-with-at-least-32-characters-long` JWT
// secret) — not a real credential, safe to commit.
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const SESSION_SECRET = 'test-session-secret';

async function isDbReachable(): Promise<boolean> {
  const probe = new SQL(DB_URL);
  try {
    await probe`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.close();
  }
}

const env: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET,
};

async function generalStaffCookie(): Promise<string> {
  const token = await sign(
    {
      sub: '99999999-9999-9999-9999-999999999999',
      role: 'general',
      regionId: null,
      tournamentType: null,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

async function regionalStaffCookie(regionId: string): Promise<string> {
  const token = await sign(
    {
      sub: '88888888-8888-8888-8888-888888888888',
      role: 'regional',
      regionId,
      tournamentType: 'saikyoi',
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

// These requests short-circuit in `requireGeneralStaff()` or `zValidator()`
// before any database call, so they run unconditionally (including CI)
// against a fixed region UUID rather than a Supabase-provisioned one.
describe('tournaments routes (request validation)', () => {
  const fixedRegionId = '00000000-0000-0000-0000-000000000000';

  it('rejects regional staff with 403', async () => {
    const cookie = await regionalStaffCookie(fixedRegionId);

    const res = await app.request(
      '/api/tournaments',
      {
        method: 'POST',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify({
          regionId: fixedRegionId,
          type: 'saikyoi',
          name: 'テスト大会',
          capacity: null,
          entryOpensAt: '2026-01-01T00:00:00+09:00',
          entryClosesAt: '2026-01-31T00:00:00+09:00',
        }),
      },
      env,
    );

    expect(res.status).toBe(403);
  });

  it('rejects a body missing entryOpensAt with 400', async () => {
    const cookie = await generalStaffCookie();

    const res = await app.request(
      '/api/tournaments',
      {
        method: 'POST',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify({
          regionId: fixedRegionId,
          type: 'saikyoi',
          name: 'テスト大会',
          capacity: null,
          entryClosesAt: '2026-01-31T00:00:00+09:00',
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  it('rejects an invalid tournamentSlug with 400', async () => {
    const res = await app.request(
      '/api/tournaments/some-region/not-a-type',
      {},
      env,
    );

    expect(res.status).toBe(400);
  });
});

// The by-slug read is public only while the entry period is open; outside
// it, it belongs to the tournament's own staff (`middleware/entry-period.ts`).
// Mocked rather than run against Supabase so these hold in CI too.
describe('GET /tournaments/:regionSlug/:tournamentSlug (entry period)', () => {
  const originalFetch = globalThis.fetch;
  const path = '/api/tournaments/some-region/saikyoi';
  const otherRegionId = '77777777-7777-7777-7777-777777777777';

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** Answers the region and tournament lookups the gate makes, alone. */
  function mockTournamentFetch(
    tournament: ReturnType<typeof openEntryPeriodTournament> | null,
  ): void {
    globalThis.fetch = tournamentAwareFetch(tournament, (() =>
      Promise.resolve(Response.json([]))) as unknown as typeof fetch);
  }

  it('serves the tournament during the entry period without a session', async () => {
    mockTournamentFetch(openEntryPeriodTournament());

    const res = await app.request(path, {}, env);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.regionId).toBe(TEST_REGION_ID);
  });

  it('returns 403 outside the entry period without a session', async () => {
    mockTournamentFetch(closedEntryPeriodTournament());

    const res = await app.request(path, {}, env);

    expect(res.status).toBe(403);
    expect((await res.json()) as unknown).toEqual({
      error: 'entry period closed',
    });
  });

  it('returns the tournament outside the entry period for its own regional staff', async () => {
    mockTournamentFetch(closedEntryPeriodTournament());

    const res = await app.request(
      path,
      {headers: {cookie: await regionalStaffCookie(TEST_REGION_ID)}},
      env,
    );

    expect(res.status).toBe(200);
  });

  it('returns the tournament outside the entry period for general staff', async () => {
    mockTournamentFetch(closedEntryPeriodTournament());

    const res = await app.request(
      path,
      {headers: {cookie: await generalStaffCookie()}},
      env,
    );

    expect(res.status).toBe(200);
  });

  it("returns 403 outside the entry period for another region's staff", async () => {
    mockTournamentFetch(closedEntryPeriodTournament());

    const res = await app.request(
      path,
      {headers: {cookie: await regionalStaffCookie(otherRegionId)}},
      env,
    );

    expect(res.status).toBe(403);
  });

  it('returns 404 for a region that has no such tournament', async () => {
    mockTournamentFetch(null);

    const res = await app.request(path, {}, env);

    expect(res.status).toBe(404);
  });
});

describe.skipIf(!(await isDbReachable()))(
  'tournaments routes (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'tournaments-route-test-region';

    afterAll(async () => {
      await sql`delete from tournaments where region_id in (
        select id from regions where slug like ${testRegionSlug + '%'}
      )`;
      await sql`delete from regions where slug like ${testRegionSlug + '%'}`;
      await sql.close();
    });

    async function createTestRegion(suffix: string): Promise<string> {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${testRegionSlug + '-' + suffix}, 'テスト地域')
        on conflict (slug) do update set name = excluded.name
        returning id
      `;
      return region.id as string;
    }

    it('creates a tournament for general staff', async () => {
      const regionId = await createTestRegion('create');
      const cookie = await generalStaffCookie();

      const res = await app.request(
        '/api/tournaments',
        {
          method: 'POST',
          headers: {cookie, 'content-type': 'application/json'},
          body: JSON.stringify({
            regionId,
            type: 'saikyoi',
            name: 'テスト大会',
            capacity: null,
            entryOpensAt: '2026-01-01T00:00:00+09:00',
            entryClosesAt: '2026-01-31T00:00:00+09:00',
          }),
        },
        env,
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(201);
      expect(body.regionId).toBe(regionId);
      expect(body.name).toBe('テスト大会');
      expect(typeof body.id).toBe('string');
    });

    it('lists tournaments for general staff', async () => {
      const regionId = await createTestRegion('list');
      const cookie = await generalStaffCookie();
      await app.request(
        '/api/tournaments',
        {
          method: 'POST',
          headers: {cookie, 'content-type': 'application/json'},
          body: JSON.stringify({
            regionId,
            type: 'shinjinou',
            name: '一覧テスト大会',
            capacity: 100,
            entryOpensAt: '2026-01-01T00:00:00+09:00',
            entryClosesAt: '2026-01-31T00:00:00+09:00',
          }),
        },
        env,
      );

      const res = await app.request(
        '/api/tournaments',
        {headers: {cookie}},
        env,
      );
      const body = (await res.json()) as Array<Record<string, unknown>>;

      expect(res.status).toBe(200);
      expect(body.some(t => t.name === '一覧テスト大会')).toBe(true);
    });

    it('updates a tournament for general staff', async () => {
      const regionId = await createTestRegion('update');
      const cookie = await generalStaffCookie();
      const createRes = await app.request(
        '/api/tournaments',
        {
          method: 'POST',
          headers: {cookie, 'content-type': 'application/json'},
          body: JSON.stringify({
            regionId,
            type: 'saikyoi',
            name: '更新前大会',
            capacity: null,
            entryOpensAt: '2026-01-01T00:00:00+09:00',
            entryClosesAt: '2026-01-31T00:00:00+09:00',
          }),
        },
        env,
      );
      const created = (await createRes.json()) as {id: string};

      const res = await app.request(
        `/api/tournaments/${created.id}`,
        {
          method: 'PATCH',
          headers: {cookie, 'content-type': 'application/json'},
          body: JSON.stringify({name: '更新後大会'}),
        },
        env,
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body.name).toBe('更新後大会');
      expect(body.id).toBe(created.id);
    });

    /**
     * Inserts a tournament whose entry period is open right now. The window
     * is relative to the clock rather than a pair of literal dates because
     * the public read below is gated on it (`middleware/entry-period.ts`) —
     * a fixed window would start answering 403 the day it passed.
     * @param regionId The region to create it in.
     * @param type The tournament type.
     */
    async function createTestTournament(
      regionId: string,
      type: string,
    ): Promise<void> {
      await sql`
        insert into tournaments
          (region_id, type, name, capacity, entry_opens_at, entry_closes_at)
        values (
          ${regionId}, ${type}, 'テスト大会', null,
          now() - interval '1 day', now() + interval '1 day'
        )
      `;
    }

    it('returns a tournament by region slug and type without staff auth', async () => {
      const suffix = 'by-slug';
      const regionId = await createTestRegion(suffix);
      await createTestTournament(regionId, 'saikyoi');

      const res = await app.request(
        `/api/tournaments/${testRegionSlug}-${suffix}/saikyoi`,
        {},
        env,
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body.regionId).toBe(regionId);
      expect(body.type).toBe('saikyoi');
    });

    it('returns 404 for an unknown region slug', async () => {
      const res = await app.request(
        `/api/tournaments/${testRegionSlug}-nonexistent/saikyoi`,
        {},
        env,
      );

      expect(res.status).toBe(404);
    });

    it('returns 404 when the region has no tournament of that type', async () => {
      const suffix = 'no-tournament';
      await createTestRegion(suffix);

      const res = await app.request(
        `/api/tournaments/${testRegionSlug}-${suffix}/shinjinou`,
        {},
        env,
      );

      expect(res.status).toBe(404);
    });
  },
);
