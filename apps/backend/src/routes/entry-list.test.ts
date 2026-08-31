import {afterAll, afterEach, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import type {Bindings} from '../types/env';
import {hashPassword} from '../lib/password';
import {app} from '../index';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';
import {
  closedEntryPeriodTournament,
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
  SESSION_SECRET: 'test-session-secret',
};

// This request is rejected by `zValidator()` before any database call, so it
// runs unconditionally (including CI).
describe('GET /tournaments/:tournamentId/entry-list (request validation)', () => {
  it('rejects a non-UUID tournamentId with 400', async () => {
    const res = await app.request(
      '/api/tournaments/not-a-uuid/entry-list',
      {},
      env,
    );

    expect(res.status).toBe(400);
  });
});

interface MockEntryRow {
  display_name: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled';
  waitlist_position: number | null;
  [extraPersonalField: string]: unknown;
}

// Mocks the `fetch` calls `@supabase/supabase-js` makes for
// `.from('entries').select(...)` (same convention as
// `routes/staff-auth.test.ts`'s `mockStaffAccountFetch`), so these run
// unconditionally in CI without a local Supabase stack. The route pages
// through the entries, so each `pages` entry answers one request and an
// exhausted mock answers with the empty page that ends the paging.
function mockEntriesFetch(...pages: MockEntryRow[][]): void {
  let callIndex = 0;
  globalThis.fetch = (() => {
    const body = pages[callIndex] ?? [];
    callIndex++;
    return Promise.resolve(Response.json(body));
  }) as unknown as typeof fetch;
}

// A request that reaches `entryListRoute`'s handler at all (rather than,
// say, being intercepted by `tournamentsRoute`'s `/:regionSlug/:tournamentSlug`
// — mounted after `entryListRoute` in `src/index.ts`, but registration order
// isn't the only thing route precedence depends on) already demonstrates
// route precedence: if `/:tournamentId/entry-list` lost precedence to
// `/:regionSlug/:tournamentSlug`, `entry-list` would fail that route's
// `tournamentSlug` enum validation and 400 before ever reaching the mocked
// fetch below, instead of the 200 these tests assert.
describe('GET /tournaments/:tournamentId/entry-list (mocked Supabase)', () => {
  const originalFetch = globalThis.fetch;
  const tournamentId = '12345678-1234-1234-1234-123456789012';

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('omits personal fields from the response', async () => {
    mockEntriesFetch([
      {
        display_name: '太郎',
        status: 'confirmed',
        waitlist_position: null,
        email: 'secret@example.com',
        name: '山田太郎',
        furigana: 'ヤマダタロウ',
        free_text: '自由記述',
      },
    ]);

    const res = await app.request(
      `/api/tournaments/${tournamentId}/entry-list`,
      {},
      env,
    );
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].displayName).toBe('太郎');
    expect(body[0]).not.toHaveProperty('email');
    expect(body[0]).not.toHaveProperty('name');
    expect(body[0]).not.toHaveProperty('furigana');
    expect(body[0]).not.toHaveProperty('freeText');
  });

  it('masks cancelled entries as "キャンセル"', async () => {
    mockEntriesFetch([
      {display_name: '太郎', status: 'cancelled', waitlist_position: null},
    ]);

    const res = await app.request(
      `/api/tournaments/${tournamentId}/entry-list`,
      {},
      env,
    );
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].displayName).toBe('キャンセル');
    expect(body[0].status).toBe('cancelled');
  });

  it('pages past the Data API row cap and returns every entry', async () => {
    // The route asks for 500 rows at a time, so a full first page has to be
    // followed by another request, and paging only ends once a request
    // comes back empty.
    const firstPage: MockEntryRow[] = Array.from({length: 500}, (_, index) => ({
      display_name: `参加者${index}`,
      status: 'confirmed',
      waitlist_position: null,
    }));

    mockEntriesFetch(firstPage, [
      {display_name: '参加者500', status: 'confirmed', waitlist_position: null},
    ]);

    const res = await app.request(
      `/api/tournaments/${tournamentId}/entry-list`,
      {},
      env,
    );
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(body).toHaveLength(501);
    expect(body[500].displayName).toBe('参加者500');
  });

  it('keeps paging when the server hands back a smaller page than asked for', async () => {
    // A deployment whose `max_rows` is below the requested page size trims
    // every response, so the first batch is short without the entries being
    // exhausted. Ending there would drop the rest.
    mockEntriesFetch(
      [
        {display_name: '参加者0', status: 'confirmed', waitlist_position: null},
        {display_name: '参加者1', status: 'confirmed', waitlist_position: null},
      ],
      [{display_name: '参加者2', status: 'confirmed', waitlist_position: null}],
    );

    const res = await app.request(
      `/api/tournaments/${tournamentId}/entry-list`,
      {},
      env,
    );
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(body).toHaveLength(3);
    expect(body[2].displayName).toBe('参加者2');
  });

  it('returns waitlistPosition for waitlisted entries', async () => {
    mockEntriesFetch([
      {display_name: '次郎', status: 'waitlisted', waitlist_position: 3},
    ]);

    const res = await app.request(
      `/api/tournaments/${tournamentId}/entry-list`,
      {},
      env,
    );
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].displayName).toBe('次郎');
    expect(body[0].status).toBe('waitlisted');
    expect(body[0].waitlistPosition).toBe(3);
  });
});

// The entry list is the one public read the entry-period gate is
// deliberately *not* on: it is a published result, and it is read most
// after entries have closed. Both routes are exercised against a tournament
// whose period is over, so attaching that gate here would fail these.
describe('the entry list stays public after the entry period', () => {
  const originalFetch = globalThis.fetch;
  const closed = closedEntryPeriodTournament();

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockClosedTournamentEntriesFetch(rows: MockEntryRow[]): void {
    let served = false;
    globalThis.fetch = tournamentAwareFetch(closed, (() => {
      const body = served ? [] : rows;
      served = true;
      return Promise.resolve(Response.json(body));
    }) as unknown as typeof fetch);
  }

  it('serves GET /tournaments/:tournamentId/entry-list', async () => {
    mockClosedTournamentEntriesFetch([
      {display_name: '太郎', status: 'confirmed', waitlist_position: null},
    ]);

    const res = await app.request(
      `/api/tournaments/${closed.id}/entry-list`,
      {},
      env,
    );
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].displayName).toBe('太郎');
  });

  // The slug-keyed twin, which is what the public list page calls now that
  // `GET /tournaments/:regionSlug/:tournamentSlug` is gated on the period.
  it('serves GET /tournaments/:regionSlug/:tournamentSlug/entry-list', async () => {
    mockClosedTournamentEntriesFetch([
      {display_name: '太郎', status: 'confirmed', waitlist_position: null},
    ]);

    const res = await app.request(
      '/api/tournaments/some-region/saikyoi/entry-list',
      {},
      env,
    );
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(body[0].displayName).toBe('太郎');
  });

  it('answers the slug-keyed route with 404 for an unknown tournament', async () => {
    globalThis.fetch = tournamentAwareFetch(null, (() =>
      Promise.resolve(Response.json([]))) as unknown as typeof fetch);

    const res = await app.request(
      '/api/tournaments/some-region/saikyoi/entry-list',
      {},
      env,
    );

    expect(res.status).toBe(404);
  });
});

describe.skipIf(!(await isDbReachable()))(
  'GET /tournaments/:tournamentId/entry-list (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'entry-list-route-test-region';
    const testEmailDomain = 'entry-list-route-test.example.com';

    async function createTournamentAndRegulation(
      suffix: string,
    ): Promise<{tournamentId: string; regulationId: string}> {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${testRegionSlug + '-' + suffix}, 'テスト地域')
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, capacity, entry_opens_at, entry_closes_at
        ) values (
          ${region.id}, 'saikyoi', 'テスト大会', null,
          '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z'
        )
        returning id
      `;
      const [regulation] = await sql`
        insert into regulations (tournament_id, label)
        values (${tournament.id}, 'テストレギュレーション')
        returning id
      `;
      return {
        tournamentId: tournament.id as string,
        regulationId: regulation.id as string,
      };
    }

    async function createEntry(
      tournamentId: string,
      regulationId: string,
      status: 'pending_verification' | 'confirmed' | 'waitlisted' | 'cancelled',
      waitlistPosition: number | null,
    ): Promise<void> {
      const email = `entry-${crypto.randomUUID()}@${testEmailDomain}`;
      const [region] = await sql`
        select region_id from tournaments where id = ${tournamentId}
      `;
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (${region.region_id}, ${email}, ${await hashPassword('password123')})
        returning id
      `;
      const [entry] = await sql`
        insert into entries (
          participant_id, tournament_id, name, furigana, display_name,
          free_text, status, waitlist_position
        ) values (
          ${participant.id}, ${tournamentId}, '山田太郎', 'ヤマダタロウ', '太郎',
          '自由記述', ${status}, ${waitlistPosition}
        )
        returning id
      `;
      await sql`
        insert into entry_regulations (entry_id, regulation_id, tournament_id)
        values (${entry.id}, ${regulationId}, ${tournamentId})
      `;
    }

    afterAll(async () => {
      await sql`delete from entries where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlug + '%'}
        )
      )`;
      await sql`delete from participants where email like ${'%@' + testEmailDomain}`;
      await sql`delete from regulations where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlug + '%'}
        )
      )`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug like ${testRegionSlug + '%'}
      )`;
      await sql`delete from regions where slug like ${testRegionSlug + '%'}`;
      await sql.close();
    });

    it('omits personal fields from the response', async () => {
      const fixture = await createTournamentAndRegulation('personal-fields');
      await createEntry(
        fixture.tournamentId,
        fixture.regulationId,
        'confirmed',
        null,
      );

      const res = await app.request(
        `/api/tournaments/${fixture.tournamentId}/entry-list`,
        {},
        env,
      );
      const body = (await res.json()) as Array<Record<string, unknown>>;

      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0]).not.toHaveProperty('email');
      expect(body[0]).not.toHaveProperty('name');
      expect(body[0]).not.toHaveProperty('furigana');
      expect(body[0]).not.toHaveProperty('freeText');
    });

    it('masks cancelled entries as "キャンセル"', async () => {
      const fixture = await createTournamentAndRegulation('cancelled');
      await createEntry(
        fixture.tournamentId,
        fixture.regulationId,
        'cancelled',
        null,
      );

      const res = await app.request(
        `/api/tournaments/${fixture.tournamentId}/entry-list`,
        {},
        env,
      );
      const body = (await res.json()) as Array<Record<string, unknown>>;

      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].displayName).toBe('キャンセル');
      expect(body[0].status).toBe('cancelled');
    });

    it('excludes pending_verification entries', async () => {
      const fixture = await createTournamentAndRegulation('pending');
      await createEntry(
        fixture.tournamentId,
        fixture.regulationId,
        'pending_verification',
        null,
      );

      const res = await app.request(
        `/api/tournaments/${fixture.tournamentId}/entry-list`,
        {},
        env,
      );
      const body = (await res.json()) as Array<Record<string, unknown>>;

      expect(res.status).toBe(200);
      expect(body).toHaveLength(0);
    });
  },
);
