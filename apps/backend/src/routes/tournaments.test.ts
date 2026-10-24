import {afterAll, afterEach, beforeEach, describe, expect, it} from 'bun:test';
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
import {
  staffSessionAwareFetch,
  TEST_SESSIONS_VALID_FROM_MS,
} from '../test-support/staff-session';

// Every staff guard checks the session against
// `staff_accounts.sessions_valid_from` before the handler runs; answer that
// read for the tests that don't stub `fetch` themselves.
const fetchWithoutSessionStub = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = staffSessionAwareFetch(fetchWithoutSessionStub);
});

afterEach(() => {
  globalThis.fetch = fetchWithoutSessionStub;
});

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
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ??
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
  SUPABASE_SECRET_KEY,
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
      sessionsValidFrom: TEST_SESSIONS_VALID_FROM_MS,
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
      sessionsValidFrom: TEST_SESSIONS_VALID_FROM_MS,
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
// Postgres's messages name tables, columns and constraints, so the route
// answers with its own wording instead (#122). PostgREST is stubbed, so
// these run without a database.
describe('tournaments routes (database errors)', () => {
  const fixedRegionId = '00000000-0000-0000-0000-000000000000';
  const tournamentId = '11111111-1111-1111-1111-111111111111';
  const createBody = {
    regionId: fixedRegionId,
    type: 'saikyoi',
    name: 'テスト大会',
    capacity: null,
    entryOpensAt: '2026-01-01T00:00:00+09:00',
    entryClosesAt: '2026-01-31T00:00:00+09:00',
  };

  /**
   * Answers every PostgREST write with `error`, as it would a refused
   * statement.
   * @param status The HTTP status PostgREST answers with.
   * @param error The PostgREST error body.
   */
  function stubPostgrestError(
    status: number,
    error: Record<string, unknown>,
  ): void {
    globalThis.fetch = staffSessionAwareFetch((async () =>
      Response.json(error, {status})) as unknown as typeof fetch);
  }

  async function request(method: 'POST' | 'PATCH'): Promise<Response> {
    return app.request(
      method === 'POST'
        ? '/api/tournaments'
        : `/api/tournaments/${tournamentId}`,
      {
        method,
        headers: {
          cookie: await generalStaffCookie(),
          'content-type': 'application/json',
        },
        body: JSON.stringify(createBody),
      },
      env,
    );
  }

  it('POST /tournaments does not leak the raw database message on a constraint violation', async () => {
    stubPostgrestError(409, {
      code: '23505',
      message:
        'duplicate key value violates unique constraint "tournaments_region_id_type_key"',
      details: 'Key (region_id, type)=(…, saikyoi) already exists.',
      hint: null,
    });

    const res = await request('POST');
    const text = await res.text();

    expect(res.status).toBe(400);
    expect(JSON.parse(text)).toEqual({
      error: 'この地域には同じ種別の大会がすでにあります',
    });
    expect(text).not.toContain('tournaments_region_id_type_key');
  });

  it('PATCH /tournaments/:id reports a region that does not exist in Japanese', async () => {
    stubPostgrestError(409, {
      code: '23503',
      message:
        'insert or update on table "tournaments" violates foreign key constraint "tournaments_region_id_fkey"',
      details: null,
      hint: null,
    });

    const res = await request('PATCH');

    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toEqual({
      error: '指定された地域が存在しません',
    });
  });

  it('answers any other database error with a generic 500', async () => {
    stubPostgrestError(400, {
      code: '23514',
      message:
        'new row for relation "tournaments" violates check constraint "x"',
      details: null,
      hint: null,
    });

    const res = await request('POST');

    expect(res.status).toBe(500);
    expect((await res.json()) as unknown).toEqual({
      error: 'internal server error',
    });
  });
});

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
    globalThis.fetch = staffSessionAwareFetch(
      tournamentAwareFetch(tournament, (() =>
        Promise.resolve(Response.json([]))) as unknown as typeof fetch),
    );
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

// The by-slug read and the by-id read, with PostgREST stubbed by a fixture
// that honours the filters the route sends, so a region or type that
// doesn't match finds nothing the way the real join would (#123).
describe('GET /tournaments/:id and /:regionSlug/:tournamentSlug (queries)', () => {
  const originalFetch = globalThis.fetch;
  const tournament = openEntryPeriodTournament();

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /**
   * Answers `tournaments` reads with `tournament` when every `eq` filter on
   * the request matches it, recording each Supabase URL besides the staff
   * session check.
   * @param calls Collects the requested URLs.
   */
  function mockFilteringFetch(calls: URL[] = []): void {
    const known: Record<string, string> = {
      id: tournament.id,
      type: tournament.type,
      'regions.slug': 'tokyo',
    };
    globalThis.fetch = staffSessionAwareFetch(((input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input);
      calls.push(url);
      if (!url.pathname.endsWith('/rest/v1/tournaments')) {
        return Promise.resolve(Response.json([]));
      }
      const matches = [...url.searchParams].every(
        ([key, value]) =>
          !value.startsWith('eq.') || known[key] === value.slice(3),
      );
      return Promise.resolve(
        Response.json(
          matches ? [{...tournament, regions: {slug: 'tokyo'}}] : [],
        ),
      );
    }) as unknown as typeof fetch);
  }

  it('GET /tournaments/:regionSlug/:tournamentSlug returns 404 for an unknown region', async () => {
    mockFilteringFetch();

    const res = await app.request('/api/tournaments/osaka/saikyoi', {}, env);

    expect(res.status).toBe(404);
  });

  it('GET /tournaments/:regionSlug/:tournamentSlug returns 404 for a known region without that tournament type', async () => {
    mockFilteringFetch();

    const res = await app.request('/api/tournaments/tokyo/shinjinou', {}, env);

    expect(res.status).toBe(404);
  });

  it('GET /tournaments/:regionSlug/:tournamentSlug resolves in a single query', async () => {
    const calls: URL[] = [];
    mockFilteringFetch(calls);

    const res = await app.request('/api/tournaments/tokyo/saikyoi', {}, env);

    expect(res.status).toBe(200);
    // The embed is filtered on but not answered with.
    expect((await res.json()) as unknown).not.toHaveProperty('regions');
    expect(calls).toHaveLength(1);
    expect(calls[0].pathname).toEndWith('/rest/v1/tournaments');
    expect(calls[0].searchParams.get('select')).toContain(
      'regions!inner(slug)',
    );
  });

  it('GET /tournaments/:id returns the tournament for general staff', async () => {
    mockFilteringFetch();

    const res = await app.request(
      `/api/tournaments/${tournament.id}`,
      {headers: {cookie: await generalStaffCookie()}},
      env,
    );

    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({
      id: tournament.id,
      regionId: tournament.region_id,
      type: tournament.type,
      name: tournament.name,
      capacity: tournament.capacity,
      entryOpensAt: tournament.entry_opens_at,
      entryClosesAt: tournament.entry_closes_at,
    });
  });

  it('GET /tournaments/:id returns 404 for an id that names no tournament', async () => {
    mockFilteringFetch();

    const res = await app.request(
      '/api/tournaments/99999999-9999-9999-9999-999999999998',
      {headers: {cookie: await generalStaffCookie()}},
      env,
    );

    expect(res.status).toBe(404);
  });

  it('GET /tournaments/:id returns 403 for regional staff', async () => {
    mockFilteringFetch();

    const res = await app.request(
      `/api/tournaments/${tournament.id}`,
      {headers: {cookie: await regionalStaffCookie(tournament.region_id)}},
      env,
    );

    expect(res.status).toBe(403);
  });

  it('GET /tournaments/:id does not shadow the two-segment slug route', async () => {
    mockFilteringFetch();

    // Public, no session: had `/:id` caught it, this would be a 401.
    const bySlug = await app.request('/api/tournaments/tokyo/saikyoi', {}, env);
    // And the other way round: one segment is never read as a slug pair.
    const byId = await app.request(
      `/api/tournaments/${tournament.id}`,
      {},
      env,
    );

    expect(bySlug.status).toBe(200);
    expect(((await bySlug.json()) as {id: string}).id).toBe(tournament.id);
    expect(byId.status).toBe(401);
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
