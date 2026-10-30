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
    entries_paused: false,
    capacity: null,
    regions: {slug: regionSlug, name: regionName, allows_dual_entry: false},
    regulations: [],
  };
}

/** The entry period of a tournament whose form is open right now. */
function openPeriod(): Record<string, string> {
  const day = 24 * 60 * 60 * 1000;
  return {
    entry_opens_at: new Date(Date.now() - day).toISOString(),
    entry_closes_at: new Date(Date.now() + day).toISOString(),
  };
}

const PRIORITY_REGULATIONS = [
  {
    label: '開催地域に在住の方',
    priority_starts_at: '2026-11-01T00:00:00+00:00',
    priority_ends_at: '2026-11-05T00:00:00+00:00',
  },
  {label: 'どなたでも', priority_starts_at: null, priority_ends_at: null},
];

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

  // The order is the database's (`display_order`, set by general staff),
  // kept as it comes rather than re-sorted by region.
  it('lists every tournament without a session, in the order staff set', async () => {
    mockTournamentsFetch([
      row('tokyo', '東京', 'saikyoi'),
      row('tokyo', '東京', 'shinjinou'),
      row('hokkaido', '北海道', 'saikyoi'),
    ]);

    const res = await app.request('/api/portal/tournaments', {}, env);

    expect(res.status).toBe(200);
    expect(requestedUrl).toContain('/rest/v1/tournaments');
    expect(decodeURIComponent(requestedUrl)).toContain(
      'order=display_order.asc,id.asc',
    );
    expect((await res.json()) as unknown).toEqual([
      {
        regionSlug: 'tokyo',
        regionName: '東京',
        regionAllowsDualEntry: false,
        tournamentType: 'saikyoi',
        tournamentName: '東京最強位',
        entryOpensAt: '2026-11-01T00:00:00+00:00',
        entryClosesAt: '2026-11-30T00:00:00+00:00',
        entriesPaused: false,
        capacity: null,
        priorityRegulations: [],
      },
      {
        regionSlug: 'tokyo',
        regionName: '東京',
        regionAllowsDualEntry: false,
        tournamentType: 'shinjinou',
        tournamentName: '東京新人王',
        entryOpensAt: '2026-11-01T00:00:00+00:00',
        entryClosesAt: '2026-11-30T00:00:00+00:00',
        entriesPaused: false,
        capacity: null,
        priorityRegulations: [],
      },
      {
        regionSlug: 'hokkaido',
        regionName: '北海道',
        regionAllowsDualEntry: false,
        tournamentType: 'saikyoi',
        tournamentName: '北海道最強位',
        entryOpensAt: '2026-11-01T00:00:00+00:00',
        entryClosesAt: '2026-11-30T00:00:00+00:00',
        entriesPaused: false,
        capacity: null,
        priorityRegulations: [],
      },
    ]);
  });

  it('answers whether the region allows entering both tournaments', async () => {
    mockTournamentsFetch([
      {
        ...row('tokyo', '東京', 'saikyoi'),
        regions: {slug: 'tokyo', name: '東京', allows_dual_entry: true},
      },
      row('hokkaido', '北海道', 'saikyoi'),
    ]);

    const res = await app.request('/api/portal/tournaments', {}, env);
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(decodeURIComponent(requestedUrl)).toContain(
      'regions!inner(slug,name,allows_dual_entry)',
    );
    expect(body.map(t => t.regionAllowsDualEntry)).toEqual([true, false]);
  });

  it('answers the capacity and, for an open form, its priority windows', async () => {
    mockTournamentsFetch([
      {
        ...row('tokyo', '東京', 'saikyoi'),
        ...openPeriod(),
        capacity: 48,
        regulations: PRIORITY_REGULATIONS,
      },
    ]);

    const res = await app.request('/api/portal/tournaments', {}, env);
    const [tournament] = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(decodeURIComponent(requestedUrl)).toContain(
      'regulations.order=display_order.asc',
    );
    expect(tournament.capacity).toBe(48);
    expect(tournament.priorityRegulations).toEqual([
      {
        label: '開催地域に在住の方',
        priorityStartsAt: '2026-11-01T00:00:00+00:00',
        priorityEndsAt: '2026-11-05T00:00:00+00:00',
      },
    ]);
  });

  // The regulations are part of the form the entry-period gate keeps
  // unpublished, so the portal mustn't become a way round it.
  it('says a paused form is paused and leaves its regulations unlisted', async () => {
    mockTournamentsFetch([
      {
        ...row('tokyo', '東京', 'saikyoi'),
        ...openPeriod(),
        entries_paused: true,
        regulations: PRIORITY_REGULATIONS,
      },
    ]);

    const res = await app.request('/api/portal/tournaments', {}, env);
    const [tournament] = (await res.json()) as Array<Record<string, unknown>>;

    expect(tournament.entriesPaused).toBe(true);
    expect(tournament.priorityRegulations).toEqual([]);
  });

  it('leaves the regulations of a form that is not open unlisted', async () => {
    mockTournamentsFetch([
      {
        ...row('tokyo', '東京', 'saikyoi'),
        entry_opens_at: '2099-01-01T00:00:00+00:00',
        entry_closes_at: '2099-01-31T00:00:00+00:00',
        regulations: PRIORITY_REGULATIONS,
      },
    ]);

    const res = await app.request('/api/portal/tournaments', {}, env);
    const [tournament] = (await res.json()) as Array<Record<string, unknown>>;

    expect(tournament.priorityRegulations).toEqual([]);
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
