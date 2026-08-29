import {afterAll, afterEach, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import {sign} from 'hono/jwt';
import type {Bindings} from '../types/env';
import app from '../index';
import {PERMISSIVE_SECURITY_BINDINGS} from '../test-support/bindings';

// Local Supabase stack (`supabase start`), same convention as
// `routes/form-definitions.test.ts`. The integration block below is skipped
// automatically when it isn't reachable, e.g. in CI.
const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

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

// Publicly documented local-dev demo key for Supabase CLI's default stack
// (fixed `super-secret-jwt-token-with-at-least-32-characters-long` JWT
// secret) — not a real credential, safe to commit.
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const SESSION_SECRET = 'test-session-secret';

const env: Bindings = {
  ...PERMISSIVE_SECURITY_BINDINGS,
  SUPABASE_URL: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY,
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET,
};

async function staffCookie(role: 'general' | 'regional'): Promise<string> {
  const token = await sign(
    {
      sub: '99999999-9999-9999-9999-999999999999',
      role,
      regionId:
        role === 'general' ? null : '11111111-1111-1111-1111-111111111111',
      tournamentType: role === 'general' ? null : 'saikyoi',
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

// This request is rejected by `zValidator()` before any database call, so it
// runs unconditionally (including CI).
describe('GET /tournaments/:tournamentId/regulations (request validation)', () => {
  it('rejects a non-UUID tournamentId with 400', async () => {
    const res = await app.request(
      '/api/tournaments/not-a-uuid/regulations',
      {},
      env,
    );

    expect(res.status).toBe(400);
  });
});

// Mocks the `fetch` call `@supabase/supabase-js` makes for
// `.from('regulations').select(...)` (same convention as
// `routes/entry-list.test.ts`'s `mockEntriesFetch`), so these run
// unconditionally in CI without a local Supabase stack.
function mockRegulationsFetch(rows: unknown[]): void {
  globalThis.fetch = (() =>
    Promise.resolve(Response.json(rows))) as unknown as typeof fetch;
}

/** Answers the same call with a Supabase-shaped failure instead. */
function mockRegulationsFetchFailure(message: string): void {
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({message}, {status: 500}),
    )) as unknown as typeof fetch;
}

// Reaching this handler at all already demonstrates route precedence: the
// path also matches `tournamentsRoute`'s `/:regionSlug/:tournamentSlug`,
// whose `tournamentSlug` enum validation would 400 on `regulations` before
// the mocked fetch below was ever consulted.
describe('GET /tournaments/:tournamentId/regulations (mocked Supabase)', () => {
  const originalFetch = globalThis.fetch;
  const tournamentId = '12345678-1234-1234-1234-123456789012';

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the tournament regulations in the API shape', async () => {
    mockRegulationsFetch([
      {
        id: '22222222-2222-2222-2222-222222222222',
        tournament_id: tournamentId,
        label: '一般の部',
        priority_starts_at: '2026-01-01T00:00:00+00:00',
        priority_ends_at: '2026-01-08T00:00:00+00:00',
        display_order: 0,
      },
      {
        id: '33333333-3333-3333-3333-333333333333',
        tournament_id: tournamentId,
        label: '学生の部',
        priority_starts_at: null,
        priority_ends_at: null,
        display_order: 1,
      },
    ]);

    const res = await app.request(
      `/api/tournaments/${tournamentId}/regulations`,
      {},
      env,
    );
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({
      id: '22222222-2222-2222-2222-222222222222',
      tournamentId,
      label: '一般の部',
      priorityStartsAt: '2026-01-01T00:00:00+00:00',
      priorityEndsAt: '2026-01-08T00:00:00+00:00',
      displayOrder: 0,
    });
    expect(body[1].priorityStartsAt).toBeNull();
  });

  it('answers a query failure without the Supabase message', async () => {
    mockRegulationsFetchFailure('relation "regulations" does not exist');

    const res = await app.request(
      `/api/tournaments/${tournamentId}/regulations`,
      {},
      env,
    );
    const body = await res.json();

    // Anonymously reachable, so the database's own wording never reaches
    // the caller.
    expect(res.status).toBe(500);
    expect(body).toEqual({error: 'internal server error'});
  });

  it('returns an empty list for a tournament with no regulations', async () => {
    mockRegulationsFetch([]);

    const res = await app.request(
      `/api/tournaments/${tournamentId}/regulations`,
      {},
      env,
    );

    const body = (await res.json()) as unknown[];

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

// These requests short-circuit in `requireGeneralStaff()` or `zValidator()`
// before any database call, so they run unconditionally (including CI).
describe('PUT /tournaments/:tournamentId/regulations (request validation)', () => {
  const tournamentId = '12345678-1234-1234-1234-123456789012';
  const body = JSON.stringify({regulations: [{label: '一般の部'}]});

  it('rejects a request without a staff session with 401', async () => {
    const res = await app.request(
      `/api/tournaments/${tournamentId}/regulations`,
      {method: 'PUT', headers: {'content-type': 'application/json'}, body},
      env,
    );

    expect(res.status).toBe(401);
  });

  it('rejects regional staff with 403', async () => {
    const cookie = await staffCookie('regional');

    const res = await app.request(
      `/api/tournaments/${tournamentId}/regulations`,
      {
        method: 'PUT',
        headers: {cookie, 'content-type': 'application/json'},
        body,
      },
      env,
    );

    expect(res.status).toBe(403);
  });

  it('rejects an empty regulation list with 400', async () => {
    const cookie = await staffCookie('general');

    const res = await app.request(
      `/api/tournaments/${tournamentId}/regulations`,
      {
        method: 'PUT',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify({regulations: []}),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  it('rejects a half-open priority window with 400', async () => {
    const cookie = await staffCookie('general');

    const res = await app.request(
      `/api/tournaments/${tournamentId}/regulations`,
      {
        method: 'PUT',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify({
          regulations: [
            {label: '優先の部', priorityStartsAt: '2026-01-01T00:00:00Z'},
          ],
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
  });
});

describe.skipIf(!(await isDbReachable()))(
  'PUT /tournaments/:tournamentId/regulations (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'regulations-route-test-region';
    // `tournaments` is unique on `(region_id, type)`, so each test gets its
    // own region (suffixed slug) rather than sharing one.
    const testRegionSlugPattern = `${testRegionSlug}-%`;
    const testEmailPattern = 'regulations-route-test-%@example.com';

    async function deleteTestRegions(): Promise<void> {
      await sql`delete from entries where participant_id in (
        select id from participants where email like ${testEmailPattern}
      )`;
      await sql`delete from participants where email like ${testEmailPattern}`;
      await sql`delete from regulations where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlugPattern}
        )
      )`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug like ${testRegionSlugPattern}
      )`;
      await sql`delete from regions where slug like ${testRegionSlugPattern}`;
    }

    // Also cleaned up up front, so rows left behind by an interrupted run
    // don't collide with this run's inserts.
    beforeAll(deleteTestRegions);

    afterAll(async () => {
      await deleteTestRegions();
      await sql.close();
    });

    /**
     * Creates a 最強位 tournament in a region of its own.
     * @param regionSuffix Distinguishes this test's region from the others'.
     */
    async function createTestTournament(
      regionSuffix: string,
    ): Promise<{regionId: string; tournamentId: string}> {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${`${testRegionSlug}-${regionSuffix}`}, 'テスト地域')
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at
        ) values (
          ${region.id}, 'saikyoi', 'テスト大会', now(), now()
        )
        returning id
      `;
      return {
        regionId: region.id as string,
        tournamentId: tournament.id as string,
      };
    }

    async function regulationsOf(
      tournamentId: string,
    ): Promise<Array<{id: string; label: string; display_order: number}>> {
      return await sql`
        select id, label, display_order from regulations
        where tournament_id = ${tournamentId}
        order by display_order
      `;
    }

    /** Puts `regulations` as general staff and returns the response. */
    async function put(
      tournamentId: string,
      regulations: unknown[],
    ): Promise<Response> {
      const cookie = await staffCookie('general');
      return await app.request(
        `/api/tournaments/${tournamentId}/regulations`,
        {
          method: 'PUT',
          headers: {cookie, 'content-type': 'application/json'},
          body: JSON.stringify({regulations}),
        },
        env,
      );
    }

    it('updates rows given an id and inserts rows without one', async () => {
      const {tournamentId} = await createTestTournament('upsert');
      await put(tournamentId, [{label: '一般の部'}]);
      const [existing] = await regulationsOf(tournamentId);

      const res = await put(tournamentId, [
        {
          id: existing.id,
          label: '一般の部(改)',
          priorityStartsAt: '2026-01-01T00:00:00Z',
          priorityEndsAt: '2026-01-08T00:00:00Z',
        },
        {label: '学生の部'},
      ]);

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({ok: true});
      const rows = await regulationsOf(tournamentId);
      expect(rows).toHaveLength(2);
      // The updated row keeps its id, which is what lets existing entries
      // go on pointing at it.
      expect(rows[0].id).toBe(existing.id);
      expect(rows[0].label).toBe('一般の部(改)');
      expect(rows[1].label).toBe('学生の部');
    });

    it('renumbers display_order from the array order', async () => {
      const {tournamentId} = await createTestTournament('order');
      await put(tournamentId, [{label: 'A'}, {label: 'B'}, {label: 'C'}]);
      const before = await regulationsOf(tournamentId);

      const res = await put(
        tournamentId,
        [before[2], before[0], before[1]].map(row => ({
          id: row.id,
          label: row.label,
        })),
      );

      expect(res.status).toBe(200);
      const rows = await regulationsOf(tournamentId);
      expect(rows.map(row => row.label)).toEqual(['C', 'A', 'B']);
      expect(rows.map(row => row.display_order)).toEqual([0, 1, 2]);
    });

    it('deletes a regulation no entry refers to', async () => {
      const {tournamentId} = await createTestTournament('delete');
      await put(tournamentId, [{label: '残る'}, {label: '消える'}]);
      const [kept] = await regulationsOf(tournamentId);

      const res = await put(tournamentId, [{id: kept.id, label: '残る'}]);

      expect(res.status).toBe(200);
      expect((await regulationsOf(tournamentId)).map(row => row.label)).toEqual(
        ['残る'],
      );
    });

    it('returns 409 when a removed regulation is referenced by an entry', async () => {
      const {regionId, tournamentId} = await createTestTournament('in-use');
      await put(tournamentId, [{label: '使用中の部'}]);
      const [inUse] = await regulationsOf(tournamentId);
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (
          ${regionId}, 'regulations-route-test-1@example.com', 'hash'
        )
        returning id
      `;
      const [entry] = await sql`insert into entries ${sql({
        participant_id: participant.id,
        tournament_id: tournamentId,
        name: '山田太郎',
        furigana: 'ヤマダタロウ',
        display_name: '太郎',
      })} returning id`;
      await sql`
        insert into entry_regulations (entry_id, regulation_id, tournament_id)
        values (${entry.id}, ${inUse.id}, ${tournamentId})
      `;

      const res = await put(tournamentId, [{label: '別の部'}]);
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(409);
      // The staff screen shows this verbatim, so the label the staff member
      // tried to drop has to be in it.
      expect(body.error).toContain('使用中の部');
      // Nothing was written: the sync is a single transaction, so the
      // regulation the entry points at is still there and no new one was
      // added alongside it.
      expect((await regulationsOf(tournamentId)).map(row => row.label)).toEqual(
        ['使用中の部'],
      );
    });

    it('returns 400 for an id belonging to another tournament', async () => {
      const other = await createTestTournament('other-owner');
      await put(other.tournamentId, [{label: 'よその大会の部'}]);
      const [otherRegulation] = await regulationsOf(other.tournamentId);
      const {tournamentId} = await createTestTournament('foreign-id');

      const res = await put(tournamentId, [
        {id: otherRegulation.id, label: '乗っ取り'},
      ]);

      expect(res.status).toBe(400);
      // The other tournament's regulation must be untouched.
      expect(
        (await regulationsOf(other.tournamentId)).map(row => row.label),
      ).toEqual(['よその大会の部']);
    });

    it('returns 404 for an unknown tournament', async () => {
      const res = await put('00000000-0000-0000-0000-000000000000', [
        {label: '一般の部'},
      ]);

      expect(res.status).toBe(404);
    });
  },
);
