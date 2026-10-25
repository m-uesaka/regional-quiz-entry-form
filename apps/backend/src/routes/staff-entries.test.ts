import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {sign} from 'hono/jwt';
import type {Bindings} from '../types/env';
import {app} from '../index';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';
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

const ENV: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'dummy-service-role-key',
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
      sessionsValidFrom: TEST_SESSIONS_VALID_FROM_MS,
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
      sessionsValidFrom: TEST_SESSIONS_VALID_FROM_MS,
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
  free_text: '自由記述',
  custom_field_values: {},
  status: 'pending_verification',
  waitlist_position: null,
  participants: {email: 'taro@example.com'},
  // Deliberately out of display order, so the route is seen to sort them
  // rather than passing the embed through as it arrived.
  entry_regulations: [
    {
      regulation_id: '77777777-7777-7777-7777-777777777777',
      regulations: {label: '学生の部', display_order: 1},
    },
    {
      regulation_id: '66666666-6666-6666-6666-666666666666',
      regulations: {label: '一般の部', display_order: 0},
    },
  ],
};

const FORM_FIELD_DEF_ROWS = [
  {
    field_key: 't_shirt_size',
    label: 'Tシャツサイズ',
    field_type: 'radio',
    required: true,
    options: ['S', 'M', 'L'],
    display_order: 0,
  },
  {
    field_key: 'agree_to_rules',
    label: '規約に同意する',
    field_type: 'checkbox',
    required: false,
    options: null,
    display_order: 1,
  },
];

/** What `requireStaffForTournament()`'s tournament read finds. */
const TOURNAMENT_PAGE = [{region_id: REGION_ID, type: 'saikyoi'}];

/**
 * Mocks the sequence of `fetch` calls Supabase's REST client makes,
 * returning each `responses` entry's body in order (one per call). A
 * scope-checked request under `requireStaffForTournament()` /
 * `requireStaffForEntry()` makes one call for the scope lookup followed by
 * one for the route handler's own query. `requireStaffForTournament()`
 * reads the tournament for general staff too (it hands the row to the
 * handler, #123), so those requests start with `TOURNAMENT_PAGE` as well;
 * `requireStaffForEntry()` skips its lookup for them. The single-entry
 * detail route makes one further call after that to fetch the tournament's
 * form field defs. An array body also carries the `Content-Range` total
 * PostgREST sends, which supabase-js only reads for an exact-count query
 * such as the paginated list's.
 */
function mockSequentialFetch(responses: unknown[]): void {
  let callIndex = 0;
  globalThis.fetch = staffSessionAwareFetch((() => {
    const body = responses[callIndex] ?? [];
    callIndex++;
    const headers: Record<string, string> = Array.isArray(body)
      ? {'Content-Range': `0-${body.length - 1}/${body.length}`}
      : {};
    return Promise.resolve(Response.json(body, {headers}));
  }) as unknown as typeof fetch);
}

/** Shape of one page of the staff entry-list response. */
interface EntryListPage {
  items: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
}

/**
 * Mocks the entries list request for general staff the way PostgREST
 * answers an exact-count query over `rows`: the requested `offset` /
 * `limit` slice, with the total in `Content-Range`. The guard's tournament
 * read that comes first is answered with `TOURNAMENT_PAGE`. Each entries
 * request's URL is recorded, so tests can see the filter and page that
 * were asked for.
 * @param rows Every row the query would match.
 */
function mockEntriesListFetch(rows: unknown[]): URL[] {
  const requests: URL[] = [];
  globalThis.fetch = staffSessionAwareFetch(((input: RequestInfo | URL) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    if (url.pathname.endsWith('/tournaments')) {
      return Promise.resolve(Response.json(TOURNAMENT_PAGE));
    }
    requests.push(url);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? rows.length);
    const page = rows.slice(offset, offset + limit);
    const range =
      page.length > 0 ? `${offset}-${offset + page.length - 1}` : '*';
    return Promise.resolve(
      Response.json(page, {
        headers: {'Content-Range': `${range}/${rows.length}`},
      }),
    );
  }) as unknown as typeof fetch);
  return requests;
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
    const body = (await res.json()) as EntryListPage;

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: ENTRY_ID,
      name: '山田太郎',
      furigana: 'ヤマダタロウ',
      displayName: '太郎',
      email: 'taro@example.com',
      regulationLabels: ['一般の部', '学生の部'],
      freeText: '自由記述',
      status: 'pending_verification',
    });
  });

  it('returns one page with the total count', async () => {
    const requests = mockEntriesListFetch(
      Array.from({length: 150}, (_, index) => ({
        ...FULL_ENTRY_ROW,
        id: `55555555-5555-5555-5555-${String(index).padStart(12, '0')}`,
        name: `参加者${index}`,
      })),
    );
    const cookie = await generalStaffCookie();

    const res = await app.request(
      `/api/staff/tournaments/${TOURNAMENT_ID}/entries?limit=20&offset=100`,
      {headers: {cookie}},
      ENV,
    );
    const body = (await res.json()) as EntryListPage;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({total: 150, limit: 20, offset: 100});
    expect(body.items).toHaveLength(20);
    expect(body.items[0].name).toBe('参加者100');
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get('order')).toBe('created_at.asc,id.asc');
  });

  it('GET /staff/.../entries filters by status', async () => {
    const requests = mockEntriesListFetch([
      {...FULL_ENTRY_ROW, status: 'waitlisted', waitlist_position: 1},
    ]);
    const cookie = await generalStaffCookie();

    const res = await app.request(
      `/api/staff/tournaments/${TOURNAMENT_ID}/entries?status=waitlisted`,
      {headers: {cookie}},
      ENV,
    );
    const body = (await res.json()) as EntryListPage;

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.items[0].status).toBe('waitlisted');
    // The filter is applied by the query, so the total counts only the
    // matching entries and the pager follows the filter.
    expect(requests[0].searchParams.get('status')).toBe('eq.waitlisted');
    expect(requests[0].searchParams.get('tournament_id')).toBe(
      `eq.${TOURNAMENT_ID}`,
    );
  });

  it('does not filter by status unless asked to', async () => {
    const requests = mockEntriesListFetch([FULL_ENTRY_ROW]);
    const cookie = await generalStaffCookie();

    const res = await app.request(
      `/api/staff/tournaments/${TOURNAMENT_ID}/entries`,
      {headers: {cookie}},
      ENV,
    );

    expect(res.status).toBe(200);
    expect(requests[0].searchParams.has('status')).toBe(false);
    expect(requests[0].searchParams.get('limit')).toBe('100');
  });

  it('rejects an unknown status and a limit over the maximum', async () => {
    const requests = mockEntriesListFetch([FULL_ENTRY_ROW]);
    const cookie = await generalStaffCookie();

    for (const query of ['status=nope', 'limit=501']) {
      const res = await app.request(
        `/api/staff/tournaments/${TOURNAMENT_ID}/entries?${query}`,
        {headers: {cookie}},
        ENV,
      );

      expect(res.status).toBe(400);
    }
    expect(requests).toHaveLength(0);
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
    mockSequentialFetch([TOURNAMENT_PAGE, [FULL_ENTRY_ROW]]);
    const cookie = await generalStaffCookie();

    const res = await app.request(
      `/api/staff/tournaments/${TOURNAMENT_ID}/entries`,
      {headers: {cookie}},
      ENV,
    );

    expect(res.status).toBe(200);
  });
});

describe('GET /staff/tournaments/:id/entries.csv (mocked Supabase)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const CSV_ENTRY_ROW = {
    name: '山田太郎',
    furigana: 'ヤマダタロウ',
    display_name: '太郎',
    custom_field_values: {
      t_shirt_size: 'M',
      agree_to_rules: ['agree_to_rules'],
    },
    status: 'confirmed',
    entry_regulations: [
      {
        regulation_id: '77777777-7777-7777-7777-777777777777',
        regulations: {label: '学生の部', display_order: 1},
      },
      {
        regulation_id: '66666666-6666-6666-6666-666666666666',
        regulations: {label: '一般の部', display_order: 0},
      },
    ],
  };

  it('returns a CSV whose custom field columns are headed by their labels', async () => {
    mockSequentialFetch([
      [{region_id: REGION_ID, type: 'saikyoi'}],
      [CSV_ENTRY_ROW],
      // The empty batch that ends `fetchAllRows()`'s paging.
      [],
      FORM_FIELD_DEF_ROWS,
    ]);
    const cookie = await regionalStaffCookie();

    const res = await app.request(
      `/api/staff/tournaments/${TOURNAMENT_ID}/entries.csv`,
      {headers: {cookie}},
      ENV,
    );
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="entries-${TOURNAMENT_ID}.csv"`,
    );
    // Leading UTF-8 BOM, so Excel doesn't render the Japanese cells as
    // mojibake.
    expect(body.startsWith('\uFEFF')).toBe(true);
    expect(body.slice(1).split('\r\n')).toEqual([
      '氏名,ふりがな,エントリーリスト掲載名,ステータス,レギュレーション,Tシャツサイズ,規約に同意する',
      '山田太郎,ヤマダタロウ,太郎,確定,一般の部;学生の部,M,はい',
    ]);
  });

  it('returns a header-only CSV when the tournament has no entries', async () => {
    mockSequentialFetch([TOURNAMENT_PAGE, [], FORM_FIELD_DEF_ROWS]);
    const cookie = await generalStaffCookie();

    const res = await app.request(
      `/api/staff/tournaments/${TOURNAMENT_ID}/entries.csv`,
      {headers: {cookie}},
      ENV,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      '\uFEFF氏名,ふりがな,エントリーリスト掲載名,ステータス,レギュレーション,Tシャツサイズ,規約に同意する',
    );
  });

  it('GET /staff/.../entries.csv still exports every row', async () => {
    // Unlike the paginated list, the export pages through every entry:
    // the route asks for 500 rows at a time and keeps asking until a batch
    // comes back empty, so a short batch (possibly trimmed by the server's
    // `max_rows`) never ends the export early.
    const firstPage = Array.from({length: 500}, (_, index) => ({
      ...CSV_ENTRY_ROW,
      name: `参加者${index}`,
    }));
    mockSequentialFetch([
      TOURNAMENT_PAGE,
      firstPage,
      [{...CSV_ENTRY_ROW, name: '参加者500'}],
      [],
      FORM_FIELD_DEF_ROWS,
    ]);
    const cookie = await generalStaffCookie();

    const res = await app.request(
      `/api/staff/tournaments/${TOURNAMENT_ID}/entries.csv`,
      {headers: {cookie}},
      ENV,
    );
    const lines = (await res.text()).slice(1).split('\r\n');

    expect(res.status).toBe(200);
    // One header line plus every row of both pages.
    expect(lines).toHaveLength(502);
    expect(lines[1].startsWith('参加者0,')).toBe(true);
    expect(lines[501].startsWith('参加者500,')).toBe(true);
  });

  it('keeps paging when the server hands back a smaller page than asked for', async () => {
    // A deployment whose `max_rows` is below the requested page size trims
    // every response, so the first batch is short without the entries being
    // exhausted. Ending the export there would drop the rest.
    mockSequentialFetch([
      TOURNAMENT_PAGE,
      [
        {...CSV_ENTRY_ROW, name: '参加者0'},
        {...CSV_ENTRY_ROW, name: '参加者1'},
      ],
      [{...CSV_ENTRY_ROW, name: '参加者2'}],
      [],
      FORM_FIELD_DEF_ROWS,
    ]);
    const cookie = await generalStaffCookie();

    const res = await app.request(
      `/api/staff/tournaments/${TOURNAMENT_ID}/entries.csv`,
      {headers: {cookie}},
      ENV,
    );
    const lines = (await res.text()).slice(1).split('\r\n');

    expect(res.status).toBe(200);
    // One header line plus every row of all three trimmed pages.
    expect(lines).toHaveLength(4);
    expect(lines[3].startsWith('参加者2,')).toBe(true);
  });

  it('returns 401 without a staff session', async () => {
    const res = await app.request(
      `/api/staff/tournaments/${TOURNAMENT_ID}/entries.csv`,
      {},
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it('returns 403 for staff of a different region', async () => {
    mockSequentialFetch([[{region_id: OTHER_REGION_ID, type: 'saikyoi'}]]);
    const cookie = await regionalStaffCookie(REGION_ID);

    const res = await app.request(
      `/api/staff/tournaments/${TOURNAMENT_ID}/entries.csv`,
      {headers: {cookie}},
      ENV,
    );

    expect(res.status).toBe(403);
  });
});

describe('GET /staff/entries/:id (mocked Supabase)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns full entry data for authorized staff, including ordered form field defs', async () => {
    mockSequentialFetch([
      [{tournaments: {region_id: REGION_ID, type: 'saikyoi'}}],
      [FULL_ENTRY_ROW],
      FORM_FIELD_DEF_ROWS,
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
      email: 'taro@example.com',
      regulationLabels: ['一般の部', '学生の部'],
      formFieldDefs: [
        {
          fieldKey: 't_shirt_size',
          label: 'Tシャツサイズ',
          fieldType: 'radio',
          required: true,
          options: ['S', 'M', 'L'],
          displayOrder: 0,
        },
        {
          fieldKey: 'agree_to_rules',
          label: '規約に同意する',
          fieldType: 'checkbox',
          required: false,
          options: null,
          displayOrder: 1,
        },
      ],
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
