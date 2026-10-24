import {afterEach, describe, expect, it} from 'bun:test';
import type {Bindings} from '../types/env';
import {app} from '../index';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';

const env: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SECRET_KEY: 'dummy-secret-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

/** A `tournaments` row with its region embedded, as the route selects it. */
function row(
  regionSlug: string,
  regionName: string,
  type: 'saikyoi' | 'shinjinou',
): Record<string, unknown> {
  return {
    type,
    // Left blank, so named after the region on read (0024).
    name: null,
    entry_opens_at: '2026-11-01T00:00:00+00:00',
    entry_closes_at: '2026-11-30T00:00:00+00:00',
    regions: {slug: regionSlug, name: regionName},
  };
}

// Mocks the `fetch` call `@supabase/supabase-js` makes for the select (same
// convention as `routes/entry-list.test.ts`), so this runs in CI without a
// local Supabase stack.
describe('GET /portal/tournaments (mocked Supabase)', () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';

  function mockTournamentsFetch(
    body: unknown,
    init: ResponseInit = {status: 200},
  ): void {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      requestedUrl = typeof input === 'string' ? input : input.toString();
      return Promise.resolve(Response.json(body, init));
    }) as unknown as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
    requestedUrl = '';
  });

  // The regions come out in Japanese collation order (東京 before 北海道,
  // as in JIS kanji order), with 最強位 before 新人王 inside each.
  it('lists every tournament without a session, region by region', async () => {
    mockTournamentsFetch([
      row('tokyo', '東京', 'shinjinou'),
      row('hokkaido', '北海道', 'saikyoi'),
      row('tokyo', '東京', 'saikyoi'),
    ]);

    const res = await app.request('/api/portal/tournaments', {}, env);

    expect(res.status).toBe(200);
    expect(requestedUrl).toContain('/rest/v1/tournaments');
    expect((await res.json()) as unknown).toEqual([
      {
        regionSlug: 'tokyo',
        regionName: '東京',
        tournamentType: 'saikyoi',
        tournamentName: '東京最強位',
        entryOpensAt: '2026-11-01T00:00:00+00:00',
        entryClosesAt: '2026-11-30T00:00:00+00:00',
      },
      {
        regionSlug: 'tokyo',
        regionName: '東京',
        tournamentType: 'shinjinou',
        tournamentName: '東京新人王',
        entryOpensAt: '2026-11-01T00:00:00+00:00',
        entryClosesAt: '2026-11-30T00:00:00+00:00',
      },
      {
        regionSlug: 'hokkaido',
        regionName: '北海道',
        tournamentType: 'saikyoi',
        tournamentName: '北海道最強位',
        entryOpensAt: '2026-11-01T00:00:00+00:00',
        entryClosesAt: '2026-11-30T00:00:00+00:00',
      },
    ]);
  });

  it('answers an empty list when there are no tournaments yet', async () => {
    mockTournamentsFetch([]);

    const res = await app.request('/api/portal/tournaments', {}, env);

    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual([]);
  });

  it('leaves out a tournament it cannot read rather than failing them all', async () => {
    mockTournamentsFetch([
      {...row('tokyo', '東京', 'saikyoi'), entry_opens_at: 'not a date'},
      row('tokyo', '東京', 'shinjinou'),
    ]);

    const res = await app.request('/api/portal/tournaments', {}, env);
    const body = (await res.json()) as Array<{tournamentName: string}>;

    expect(res.status).toBe(200);
    expect(body.map(t => t.tournamentName)).toEqual(['東京新人王']);
  });

  it('answers 500 when the tournaments cannot be read', async () => {
    mockTournamentsFetch({message: 'boom'}, {status: 500});

    const res = await app.request('/api/portal/tournaments', {}, env);

    expect(res.status).toBe(500);
  });
});
