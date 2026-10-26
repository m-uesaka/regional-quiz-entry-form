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
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ??
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
  SUPABASE_SECRET_KEY,
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
  email_verified_at: string;
  [extraPersonalField: string]: unknown;
}

/** When the mocked rows below were confirmed, as PostgREST spells it. */
const VERIFIED_AT = '2026-11-01T00:00:05.123456+00:00';

/** Shape of one page of the entry-list response. */
interface EntryListPage {
  items: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
}

/**
 * Answers one entries request the way PostgREST does for an exact-count
 * query over `rows`: the requested `offset` / `limit` slice, with the
 * total in `Content-Range`.
 * @param url The request URL `@supabase/supabase-js` built.
 * @param rows Every row the query would match.
 */
function answerEntriesPage(url: URL, rows: MockEntryRow[]): Response {
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const limit = Number(url.searchParams.get('limit') ?? rows.length);
  const page = rows.slice(offset, offset + limit);
  const range = page.length > 0 ? `${offset}-${offset + page.length - 1}` : '*';
  return Response.json(page, {
    headers: {'Content-Range': `${range}/${rows.length}`},
  });
}

// Mocks the `fetch` calls `@supabase/supabase-js` makes for
// `.from('entries').select(...)` (same convention as
// `routes/staff-auth.test.ts`'s `mockStaffAccountFetch`), so these run
// unconditionally in CI without a local Supabase stack. Every request's URL
// is recorded, so tests can see which page and order were asked for.
function mockEntriesFetch(rows: MockEntryRow[]): URL[] {
  const requests: URL[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    requests.push(url);
    return Promise.resolve(answerEntriesPage(url, rows));
  }) as unknown as typeof fetch;
  return requests;
}

/**
 * Builds `count` confirmed entry rows named `参加者0`, `参加者1`, ....
 * @param count How many rows to build.
 */
function confirmedRows(count: number): MockEntryRow[] {
  return Array.from({length: count}, (_, index) => ({
    display_name: `参加者${index}`,
    status: 'confirmed',
    waitlist_position: null,
    // A second apart, in the order the rows are listed.
    email_verified_at: new Date(
      Date.UTC(2026, 10, 1, 0, 0, index),
    ).toISOString(),
  }));
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
        email_verified_at: VERIFIED_AT,
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
    const body = (await res.json()) as EntryListPage;

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].displayName).toBe('太郎');
    expect(body.items[0]).not.toHaveProperty('email');
    expect(body.items[0]).not.toHaveProperty('name');
    expect(body.items[0]).not.toHaveProperty('furigana');
    expect(body.items[0]).not.toHaveProperty('freeText');
  });

  it('masks cancelled entries as "キャンセル"', async () => {
    mockEntriesFetch([
      {
        display_name: '太郎',
        status: 'cancelled',
        waitlist_position: null,
        email_verified_at: VERIFIED_AT,
      },
    ]);

    const res = await app.request(
      `/api/tournaments/${tournamentId}/entry-list`,
      {},
      env,
    );
    const body = (await res.json()) as EntryListPage;

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].displayName).toBe('キャンセル');
    expect(body.items[0].status).toBe('cancelled');
    expect(body.items[0].confirmedAt).toBeNull();
  });

  it('returns waitlistPosition for waitlisted entries', async () => {
    mockEntriesFetch([
      {
        display_name: '次郎',
        status: 'waitlisted',
        waitlist_position: 3,
        email_verified_at: VERIFIED_AT,
      },
    ]);

    const res = await app.request(
      `/api/tournaments/${tournamentId}/entry-list`,
      {},
      env,
    );
    const body = (await res.json()) as EntryListPage;

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].displayName).toBe('次郎');
    expect(body.items[0].status).toBe('waitlisted');
    expect(body.items[0].waitlistPosition).toBe(3);
  });

  it('returns when each entry was confirmed, and asks only for confirmed ones', async () => {
    const requests = mockEntriesFetch([
      {
        display_name: '太郎',
        status: 'confirmed',
        waitlist_position: null,
        email_verified_at: VERIFIED_AT,
      },
    ]);

    const res = await app.request(
      `/api/tournaments/${tournamentId}/entry-list`,
      {},
      env,
    );
    const body = (await res.json()) as EntryListPage;

    expect(res.status).toBe(200);
    expect(body.items[0].confirmedAt).toBe(VERIFIED_AT);
    expect(requests[0].searchParams.get('email_verified_at')).toBe(
      'not.is.null',
    );
  });

  it('GET /entry-list returns the first page and the total count', async () => {
    const requests = mockEntriesFetch(confirmedRows(150));

    const res = await app.request(
      `/api/tournaments/${tournamentId}/entry-list`,
      {},
      env,
    );
    const body = (await res.json()) as EntryListPage;

    expect(res.status).toBe(200);
    expect(body.total).toBe(150);
    expect(body.limit).toBe(100);
    expect(body.offset).toBe(0);
    expect(body.items).toHaveLength(100);
    expect(body.items[0].displayName).toBe('参加者0');
    expect(body.items[99].displayName).toBe('参加者99');
    // One request, with the total counted in it rather than by a second
    // query.
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get('offset')).toBe('0');
    expect(requests[0].searchParams.get('limit')).toBe('100');
  });

  it('GET /entry-list honours limit and offset', async () => {
    const requests = mockEntriesFetch(confirmedRows(30));

    const res = await app.request(
      `/api/tournaments/${tournamentId}/entry-list?limit=10&offset=20`,
      {},
      env,
    );
    const body = (await res.json()) as EntryListPage;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({total: 30, limit: 10, offset: 20});
    expect(body.items.map(item => item.displayName)).toEqual(
      confirmedRows(30)
        .slice(20)
        .map(row => row.display_name),
    );
    expect(requests[0].searchParams.get('offset')).toBe('20');
    expect(requests[0].searchParams.get('limit')).toBe('10');
  });

  it('GET /entry-list rejects a limit over the maximum', async () => {
    const requests = mockEntriesFetch(confirmedRows(1));

    const res = await app.request(
      `/api/tournaments/${tournamentId}/entry-list?limit=501`,
      {},
      env,
    );

    expect(res.status).toBe(400);
    expect(requests).toHaveLength(0);
  });

  it('GET /entry-list keeps a stable order across page boundaries', async () => {
    // `email_verified_at` alone is not unique, so entries confirmed in the
    // same instant could swap places between two page requests; the `id`
    // tie-breaker is what makes adjacent pages neither overlap nor skip.
    const requests = mockEntriesFetch(confirmedRows(5));

    const first = (await (
      await app.request(
        `/api/tournaments/${tournamentId}/entry-list?limit=3`,
        {},
        env,
      )
    ).json()) as EntryListPage;
    const second = (await (
      await app.request(
        `/api/tournaments/${tournamentId}/entry-list?limit=3&offset=3`,
        {},
        env,
      )
    ).json()) as EntryListPage;

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.searchParams.get('order')).toBe(
        'email_verified_at.asc,id.asc',
      );
    }
    expect(
      [...first.items, ...second.items].map(item => item.displayName),
    ).toEqual(confirmedRows(5).map(row => row.display_name));
  });

  it('answers an offset past the last entry with an empty page', async () => {
    // With an exact count PostgREST refuses such an offset with 416
    // (PGRST103) instead of an empty array; a stale pager link should
    // still get a page back, not a 500.
    const rows = confirmedRows(3);
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      if (Number(url.searchParams.get('offset')) >= rows.length) {
        return Promise.resolve(
          Response.json(
            {code: 'PGRST103', message: 'Requested range not satisfiable'},
            {status: 416},
          ),
        );
      }
      return Promise.resolve(answerEntriesPage(url, rows));
    }) as unknown as typeof fetch;

    const res = await app.request(
      `/api/tournaments/${tournamentId}/entry-list?offset=100`,
      {},
      env,
    );
    const body = (await res.json()) as EntryListPage;

    expect(res.status).toBe(200);
    expect(body).toEqual({items: [], total: 3, limit: 100, offset: 100});
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
    globalThis.fetch = tournamentAwareFetch(closed, ((
      input: RequestInfo | URL,
    ) =>
      Promise.resolve(
        answerEntriesPage(
          new URL(typeof input === 'string' ? input : input.toString()),
          rows,
        ),
      )) as unknown as typeof fetch);
  }

  it('serves GET /tournaments/:tournamentId/entry-list', async () => {
    mockClosedTournamentEntriesFetch([
      {
        display_name: '太郎',
        status: 'confirmed',
        waitlist_position: null,
        email_verified_at: VERIFIED_AT,
      },
    ]);

    const res = await app.request(
      `/api/tournaments/${closed.id}/entry-list`,
      {},
      env,
    );
    const body = (await res.json()) as EntryListPage;

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].displayName).toBe('太郎');
  });

  // The slug-keyed twin, which is what the public list page calls now that
  // `GET /tournaments/:regionSlug/:tournamentSlug` is gated on the period.
  it('serves GET /tournaments/:regionSlug/:tournamentSlug/entry-list', async () => {
    mockClosedTournamentEntriesFetch([
      {
        display_name: '太郎',
        status: 'confirmed',
        waitlist_position: null,
        email_verified_at: VERIFIED_AT,
      },
    ]);

    const res = await app.request(
      '/api/tournaments/some-region/saikyoi/entry-list',
      {},
      env,
    );
    const body = (await res.json()) as EntryListPage;

    expect(res.status).toBe(200);
    expect(body.items[0].displayName).toBe('太郎');
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
      // Every entry that got past verification has one; only a pending
      // entry, or one that lapsed unverified, does not.
      emailVerifiedAt: Date | null = status === 'pending_verification'
        ? null
        : new Date(),
      displayName = '太郎',
    ): Promise<void> {
      const email = `entry-${crypto.randomUUID()}@${testEmailDomain}`;
      const [region] = await sql`
        select region_id from tournaments where id = ${tournamentId}
      `;
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (${region.region_id}, ${email}, ${await hashPassword('quiz-entry-pass1')})
        returning id
      `;
      const [entry] = await sql`
        insert into entries (
          participant_id, tournament_id, name, furigana, display_name,
          free_text, status, waitlist_position, email_verified_at
        ) values (
          ${participant.id}, ${tournamentId}, '山田太郎', 'ヤマダタロウ',
          ${displayName}, '自由記述', ${status}, ${waitlistPosition},
          ${emailVerifiedAt}
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
      const body = ((await res.json()) as EntryListPage).items;

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
      const body = ((await res.json()) as EntryListPage).items;

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
      const body = ((await res.json()) as EntryListPage).items;

      expect(res.status).toBe(200);
      expect(body).toHaveLength(0);
    });

    it('lists entries in the order they were confirmed, not sent', async () => {
      const fixture = await createTournamentAndRegulation('confirmed-order');
      // Sent first, but its link was followed last.
      await createEntry(
        fixture.tournamentId,
        fixture.regulationId,
        'confirmed',
        null,
        new Date('2026-11-01T00:00:10Z'),
        '後から確定',
      );
      await createEntry(
        fixture.tournamentId,
        fixture.regulationId,
        'confirmed',
        null,
        new Date('2026-11-01T00:00:05Z'),
        '先に確定',
      );

      const res = await app.request(
        `/api/tournaments/${fixture.tournamentId}/entry-list`,
        {},
        env,
      );
      const body = ((await res.json()) as EntryListPage).items;

      expect(res.status).toBe(200);
      expect(body.map(item => item.displayName)).toEqual([
        '先に確定',
        '後から確定',
      ]);
      expect(new Date(body[0].confirmedAt as string).toISOString()).toBe(
        '2026-11-01T00:00:05.000Z',
      );
    });

    it('leaves out an entry that lapsed without ever being confirmed', async () => {
      const fixture = await createTournamentAndRegulation('lapsed');
      await createEntry(
        fixture.tournamentId,
        fixture.regulationId,
        'cancelled',
        null,
        null,
      );

      const res = await app.request(
        `/api/tournaments/${fixture.tournamentId}/entry-list`,
        {},
        env,
      );
      const body = (await res.json()) as EntryListPage;

      expect(res.status).toBe(200);
      expect(body.items).toHaveLength(0);
      expect(body.total).toBe(0);
    });
  },
);

// Mocks the head-only count requests `@supabase/supabase-js` makes: the
// count comes back in `Content-Range` (`*/<n>`), with no body.
describe('GET /tournaments/:tournamentId/entry-counts (mocked Supabase)', () => {
  const originalFetch = globalThis.fetch;
  const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
  let requestedUrls: string[] = [];

  function mockCounts(counts: Record<string, number> | null): void {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = decodeURIComponent(
        typeof input === 'string' ? input : input.toString(),
      );
      requestedUrls.push(url);
      if (counts === null) {
        return Promise.resolve(Response.json({message: 'boom'}, {status: 500}));
      }
      const status = /status=eq\.(\w+)/.exec(url)?.[1] ?? '';
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: {'Content-Range': `*/${counts[status] ?? 0}`},
        }),
      );
    }) as unknown as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
    requestedUrls = [];
  });

  it('answers the confirmed and waitlisted counts without a session', async () => {
    mockCounts({confirmed: 30, waitlisted: 2});

    const res = await app.request(
      `/api/tournaments/${TOURNAMENT_ID}/entry-counts`,
      {},
      env,
    );

    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({
      confirmedCount: 30,
      waitlistedCount: 2,
    });
    expect(requestedUrls).toHaveLength(2);
    for (const url of requestedUrls) {
      expect(url).toContain(`tournament_id=eq.${TOURNAMENT_ID}`);
    }
  });

  it('rejects a non-UUID tournamentId with 400', async () => {
    const res = await app.request(
      '/api/tournaments/not-a-uuid/entry-counts',
      {},
      env,
    );

    expect(res.status).toBe(400);
  });

  it('answers 500 when the entries cannot be counted', async () => {
    mockCounts(null);

    const res = await app.request(
      `/api/tournaments/${TOURNAMENT_ID}/entry-counts`,
      {},
      env,
    );

    expect(res.status).toBe(500);
  });
});
