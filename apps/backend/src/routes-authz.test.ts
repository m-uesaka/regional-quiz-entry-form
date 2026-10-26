import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {Hono} from 'hono';
import {sign} from 'hono/jwt';
import type {Bindings, Env, StaffEnv} from './types/env';
import {app} from './index';
import {
  requireOpenEntryPeriodOrStaff,
  byTournamentIdParam,
} from './middleware/entry-period';
import {requireParticipant} from './middleware/participant-auth';
import {
  requireGeneralStaff,
  requireStaffForTournament,
} from './middleware/staff-auth';
import {
  PERMISSIVE_PLATFORM_BINDINGS,
  TURNSTILE_TEST_TOKEN,
  turnstileAwareFetch,
} from './test-support/bindings';
import {
  isStaffSessionCheck,
  staffSessionRow,
  TEST_SESSIONS_VALID_FROM,
  TEST_SESSIONS_VALID_FROM_MS,
} from './test-support/staff-session';

/** A route as `METHOD /path`, the way Hono registered it. */
interface Route {
  method: string;
  path: string;
}

/**
 * Who a route lets in -- and so which requests it must refuse.
 *
 * - `public`: anyone. Not probed; the reason says why that is fine.
 * - `entry-period`: anyone while the tournament's entry period is open, its
 *   own staff otherwise (`requireOpenEntryPeriodOrStaff()`).
 * - `general-staff`: 統括スタッフ only (`requireGeneralStaff()`).
 * - `scoped-staff`: staff whose region and tournament type cover the
 *   tournament or entry (`requireStaffForTournament()` /
 *   `requireStaffForEntry()`).
 * - `participant`: a logged-in participant (`requireParticipant()`). Whether
 *   the entry is *their own* is the handler's question, decided by a query
 *   this test can't see, so it is not probed here.
 */
type Policy =
  | {access: 'public'; reason: string}
  | {access: 'entry-period'}
  | {access: 'general-staff'}
  | {access: 'scoped-staff'}
  | {access: 'participant'};

/**
 * 全ルートの認可方針。ルートを足したら、ここに方針を書かない限り下の
 * テストが落ちる。
 *
 * 認可はすべて Worker のミドルウェアが担っている(DB は service_role で
 * 触っており RLS はバイパスされる。`docs/database-schema.md` 4 章)ため、
 * ミドルウェアの付け忘れや付け間違いを止める仕組みが他に無い。方針は
 * ドキュメントから読まずにここに書く: ドキュメントの表を書き換えただけで
 * 期待する認可が緩まないようにするため。代わりに `docs/api-endpoints.md`
 * 2 章の表の「認可」列がこの方針と一致することを確かめる。
 */
const ROUTE_POLICIES: Readonly<Record<string, Policy>> = {
  'GET /api/healthz': {access: 'public', reason: 'ヘルスチェック'},
  'POST /api/auth/staff/login': {access: 'public', reason: 'ログイン'},
  'POST /api/auth/staff/password-reset/request': {
    access: 'public',
    reason: 'レート制限 + Turnstile。応答は登録の有無によらず同じ',
  },
  'POST /api/auth/staff/password-reset/confirm': {
    access: 'public',
    reason: 'トークンで認可する',
  },
  'POST /api/auth/staff/logout': {
    access: 'public',
    reason: 'Cookie を消すだけ',
  },
  'POST /api/auth/participant/login': {access: 'public', reason: 'ログイン'},
  'POST /api/auth/participant/logout': {
    access: 'public',
    reason: 'Cookie を消すだけ',
  },
  'POST /api/auth/participant/password-reset/request': {
    access: 'public',
    reason: 'レート制限 + Turnstile。応答は登録の有無によらず同じ',
  },
  'POST /api/auth/participant/password-reset/confirm': {
    access: 'public',
    reason: 'トークンで認可する',
  },
  'GET /api/regions': {access: 'general-staff'},
  'POST /api/regions': {access: 'general-staff'},
  'PATCH /api/regions/:id': {access: 'general-staff'},
  'GET /api/tournaments': {access: 'general-staff'},
  'GET /api/tournaments/:id': {access: 'general-staff'},
  'POST /api/tournaments': {access: 'general-staff'},
  'PATCH /api/tournaments/:id': {access: 'general-staff'},
  'DELETE /api/tournaments/:id': {access: 'general-staff'},
  'PUT /api/tournaments/order': {access: 'general-staff'},
  'GET /api/tournaments/:regionSlug/:tournamentSlug': {access: 'entry-period'},
  'GET /api/tournaments/:tournamentId/regulations': {access: 'entry-period'},
  'PUT /api/tournaments/:tournamentId/regulations': {access: 'general-staff'},
  'GET /api/tournaments/:tournamentId/entry-list': {
    access: 'public',
    reason: '公開エントリーリスト(掲載名・ステータス・順位のみ)',
  },
  'GET /api/tournaments/:tournamentId/entry-counts': {
    access: 'public',
    reason:
      '確定・キャンセル待ちの件数のみ(公開エントリーリストから数えられる)',
  },
  'GET /api/tournaments/:regionSlug/:tournamentSlug/entry-list': {
    access: 'public',
    reason: '公開エントリーリスト(掲載名・ステータス・順位のみ)',
  },
  'POST /api/tournaments/:tournamentId/entries': {
    access: 'public',
    reason: '未ログインのエントリー。レート制限 + Turnstile',
  },
  'POST /api/tournaments/:tournamentId/entries/session': {
    access: 'participant',
  },
  'GET /api/entries/verify': {
    access: 'public',
    reason: 'メール確認トークンで認可する',
  },
  'GET /api/form-definitions/:tournamentId': {access: 'entry-period'},
  'PUT /api/form-definitions/:tournamentId': {access: 'general-staff'},
  'POST /api/sheet-import/preview': {access: 'general-staff'},
  'POST /api/sheet-import/regulations/preview': {access: 'general-staff'},
  'POST /api/sheet-import/tournaments': {access: 'general-staff'},
  'GET /api/staff/tournaments/:tournamentId/entries': {access: 'scoped-staff'},
  'GET /api/staff/tournaments/:tournamentId/entries.csv': {
    access: 'scoped-staff',
  },
  'GET /api/staff/entries/:entryId': {access: 'scoped-staff'},
  'POST /api/staff/tournaments/:tournamentId/mail': {access: 'scoped-staff'},
  'GET /api/staff/tournaments/:tournamentId/mail/:jobId': {
    access: 'scoped-staff',
  },
  'GET /api/staff/dashboard': {access: 'general-staff'},
  'GET /api/staff/accounts': {access: 'general-staff'},
  'POST /api/staff/accounts': {access: 'general-staff'},
  'POST /api/staff/accounts/:id/password-reset': {access: 'general-staff'},
  'POST /api/staff/accounts/:id/revoke-sessions': {access: 'general-staff'},
  'POST /api/staff/accounts/:id/disable': {access: 'general-staff'},
  'POST /api/staff/accounts/:id/enable': {access: 'general-staff'},
  'GET /api/mypage/entries': {access: 'participant'},
  'GET /api/mypage/entries/:entryId': {access: 'participant'},
  'PATCH /api/mypage/entries/:entryId': {access: 'participant'},
  'DELETE /api/mypage/entries/:entryId': {access: 'participant'},
  'GET /api/portal/tournaments': {
    access: 'public',
    reason: 'ポータル(大会名・スラッグ・受付期間のみ)',
  },
};

/**
 * Registrations that carry middleware only and no handler of their own:
 * `.use()` on a path, which runs in front of the routes below it. Any other
 * middleware-only registration is reported rather than skipped -- see
 * `collectRoutes()`.
 */
const MIDDLEWARE_ONLY_REGISTRATIONS: readonly string[] = [
  'ALL /api/*',
  'ALL /api/regions/*',
  'ALL /api/sheet-import/*',
  'ALL /api/mypage/*',
];

/** What `docs/api-endpoints.md`'s 認可 column says for each policy. */
const DOCUMENTED_ACCESS: ReadonlyArray<[RegExp, Policy['access']]> = [
  [/^なし/, 'public'],
  [/^期間中はなし/, 'entry-period'],
  [/^統括スタッフ/, 'general-staff'],
  [/^スタッフ\(担当範囲\)/, 'scoped-staff'],
  [/^参加者/, 'participant'],
];

/** The methods an `.all()` route is tried with: it may branch on any. */
const ALL_METHODS: readonly string[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
];

/**
 * An app mounted under `/api` the way `src/index.ts` mounts the real one:
 * the real app, or one of the small ones the checks are tried out on.
 */
type ApiApp = typeof app;

/** `METHOD /path`, for messages and set comparisons. */
function routeKey({method, path}: Route): string {
  return `${method} ${path}`;
}

/**
 * The (method, path) of every route registered on `hono`, and the ones that
 * can't be told apart from middleware.
 *
 * `app.routes` lists every handler and middleware as an entry of its own:
 * a route's guards and validators under the route's method and path, and a
 * `.use()` as an `ALL` entry under its pattern. The only thing that tells a
 * handler from middleware is its arity (a handler takes `c`, middleware
 * takes `c, next`). So a registration with nothing but two-argument
 * functions is either a `.use()` -- listed in
 * `MIDDLEWARE_ONLY_REGISTRATIONS` -- or a route this test can't see: a
 * handler written `(c, next) => ...`, or an `app.mount()`ed sub-app. Those
 * are returned as `unrecognized`, so the test fails instead of quietly
 * leaving them out of every check.
 */
function collectRoutes(
  hono: ApiApp,
  middlewareOnly: readonly string[] = MIDDLEWARE_ONLY_REGISTRATIONS,
): {routes: Route[]; unrecognized: string[]} {
  const registrations = new Map<string, {route: Route; hasHandler: boolean}>();
  for (const {method, path, handler} of hono.routes) {
    const route = {method, path};
    const key = routeKey(route);
    const entry = registrations.get(key) ?? {route, hasHandler: false};
    entry.hasHandler ||= handler.length < 2;
    registrations.set(key, entry);
  }
  const routes: Route[] = [];
  const unrecognized: string[] = [];
  for (const [key, {route, hasHandler}] of registrations) {
    if (hasHandler) {
      routes.push(route);
    } else if (!middlewareOnly.includes(key)) {
      unrecognized.push(key);
    }
  }
  return {routes, unrecognized};
}

// Any well-formed UUID will do for an id nobody looks up.
const PLACEHOLDER_UUID = '00000000-0000-4000-8000-000000000000';

/**
 * A concrete path for a route pattern, with every parameter filled in by a
 * value its `zValidator('param', ...)` accepts. Some routes validate their
 * parameters before the guard runs, and a 400 from a malformed placeholder
 * would hide whether the guard is there at all.
 */
function toConcretePath(path: string): string {
  if (path.includes('*')) {
    throw new Error(`no concrete path for a wildcard route: ${path}`);
  }
  return path.replace(/:(\w+)/g, (_, name: string) => {
    if (name === 'tournamentSlug') {
      return 'saikyoi';
    }
    if (name === 'regionSlug') {
      return 'test-region';
    }
    return PLACEHOLDER_UUID;
  });
}

const TEST_ENV: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL: 'http://supabase.invalid',
  SUPABASE_SECRET_KEY: 'test-secret-key',
  MAIL_API_KEY: 'test-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'test-sheets-api-key',
  MAIL_FROM_ADDRESS: 'noreply@example.com',
  FRONTEND_URL: 'http://localhost:5173',
  SESSION_SECRET: 'test-session-secret',
};

// The region every tournament and entry the stub below hands back belongs
// to, and one that is not it.
const STUB_REGION_ID = '00000000-0000-4000-8000-00000000000a';
const OTHER_REGION_ID = '00000000-0000-4000-8000-00000000000b';
const PASSWORD_CHANGED_AT = '2026-08-25T00:00:00.000Z';

/** A tournament whose entry period closed long ago, in `STUB_REGION_ID`. */
const CLOSED_TOURNAMENT = {
  id: PLACEHOLDER_UUID,
  region_id: STUB_REGION_ID,
  type: 'saikyoi',
  name: 'テスト大会',
  capacity: null,
  entry_opens_at: '2020-01-01T00:00:00.000Z',
  entry_closes_at: '2020-01-31T00:00:00.000Z',
  regions: {name: 'テスト地域'},
};

/** The columns `lib/tournaments.ts` selects, as they appear in the URL. */
const TOURNAMENT_SELECT =
  'id,region_id,type,name,capacity,entry_opens_at,entry_closes_at';

/** A read a guard makes on its way to refusing, and what it is answered. */
interface GuardRead {
  kind:
    | 'staff-session'
    | 'participant-session'
    | 'scope'
    | 'tournament-by-id'
    | 'tournament-by-slug';
  body: unknown;
}

/**
 * The reads the guards make, answered the way that leads each probe to its
 * refusal: sessions are current (so a refusal is about *who*, not about a
 * stale cookie), and every tournament or entry is in `STUB_REGION_ID` with
 * a closed entry period. Anything else is a read a guard doesn't make,
 * i.e. a handler running.
 */
function classifyRead(url: URL): GuardRead | null {
  const table = url.pathname.replace(/^\/rest\/v1\//, '');
  const select = (url.searchParams.get('select') ?? '').replace(/\s/g, '');
  if (isStaffSessionCheck(url.toString())) {
    return {
      kind: 'staff-session',
      body: [staffSessionRow(TEST_SESSIONS_VALID_FROM)],
    };
  }
  if (table === 'participants' && select === 'password_changed_at') {
    return {
      kind: 'participant-session',
      body: [{password_changed_at: PASSWORD_CHANGED_AT}],
    };
  }
  if (table === 'entries' && select === 'tournaments(region_id,type)') {
    return {
      kind: 'scope',
      body: [{tournaments: {region_id: STUB_REGION_ID, type: 'saikyoi'}}],
    };
  }
  // The two tournament lookups of `lib/tournaments.ts`, matched on their
  // exact select and filters so that any other read of `tournaments` -- a
  // handler's, with its own columns or conditions -- is still caught.
  // `fetchTournamentById()` is both the entry-period gate's by-id read and
  // `requireStaffForTournament()`'s scope read (it reads the whole row to
  // hand it to the handler, #123).
  if (table === 'tournaments') {
    const filters = [...url.searchParams.keys()]
      .filter(key => key !== 'select')
      .sort()
      .join(',');
    if (select === `${TOURNAMENT_SELECT},regions(name)` && filters === 'id') {
      return {kind: 'tournament-by-id', body: [CLOSED_TOURNAMENT]};
    }
    if (
      select === `${TOURNAMENT_SELECT},regions!inner(name)` &&
      filters === 'regions.slug,type'
    ) {
      return {kind: 'tournament-by-slug', body: [CLOSED_TOURNAMENT]};
    }
  }
  return null;
}

/** Every outbound request a probe caused, other than Turnstile's siteverify. */
let outboundRequests: Array<{url: string; read: GuardRead | null}> = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  outboundRequests = [];
  // Siteverify says yes, so a challenge in front of a guard can't be the
  // reason a request is refused. Everything else is recorded. The guards'
  // own reads are answered; anything else is refused with a 400 rather
  // than a network error, which `supabase-js` would retry with a backoff
  // long enough to time the test out before it could say which route it
  // was.
  globalThis.fetch = turnstileAwareFetch(((input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const read = classifyRead(url);
    outboundRequests.push({url: url.toString(), read});
    return Promise.resolve(
      read
        ? Response.json(read.body)
        : Response.json(
            {message: 'no outbound request is expected'},
            {status: 400},
          ),
    );
  }) as typeof fetch);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** A session a probe sends, by the cookie that carries it. */
type Session =
  | 'none'
  | 'participant'
  | 'general-staff'
  | 'regional-staff-in-scope'
  | 'regional-staff-out-of-scope';

async function staffCookie(regionId: string | null): Promise<string> {
  const token = await sign(
    {
      sub: PLACEHOLDER_UUID,
      role: regionId === null ? 'general' : 'regional',
      regionId,
      tournamentType: regionId === null ? null : 'saikyoi',
      sessionsValidFrom: TEST_SESSIONS_VALID_FROM_MS,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    TEST_ENV.SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

async function cookieFor(session: Session): Promise<string | null> {
  switch (session) {
    case 'none':
      return null;
    case 'participant': {
      const issuedAt = Math.floor(Date.now() / 1000);
      const token = await sign(
        {
          sub: PLACEHOLDER_UUID,
          pwdChangedAt: Date.parse(PASSWORD_CHANGED_AT),
          iat: issuedAt,
          exp: issuedAt + 3600,
        },
        TEST_ENV.SESSION_SECRET,
      );
      return `participant_session=${token}`;
    }
    case 'general-staff':
      return staffCookie(null);
    case 'regional-staff-in-scope':
      return staffCookie(STUB_REGION_ID);
    case 'regional-staff-out-of-scope':
      return staffCookie(OTHER_REGION_ID);
  }
}

/** A request a route of some policy must refuse, and how. */
interface Probe {
  session: Session;
  status: 401 | 403;
  error: string;
  /** The guard reads this refusal may cost; anything else is a leak. */
  allowedReads: ReadonlyArray<GuardRead['kind']>;
}

const UNAUTHORIZED = 'unauthorized';
const FORBIDDEN = 'forbidden';
const ENTRY_PERIOD_CLOSED = 'entry period closed';

/**
 * What each policy must refuse. Each probe is a session that is current and
 * valid but is not the one the policy asks for, so a route guarded by the
 * wrong guard is caught as well as one guarded by none: a staff route
 * behind `requireParticipant()` lets the participant in, a 統括 route
 * behind a scoped guard lets the in-scope 地域スタッフ in.
 */
const PROBES: Readonly<Record<Exclude<Policy['access'], 'public'>, Probe[]>> = {
  'general-staff': [
    {session: 'none', status: 401, error: UNAUTHORIZED, allowedReads: []},
    {
      session: 'participant',
      status: 401,
      error: UNAUTHORIZED,
      allowedReads: [],
    },
    {
      session: 'regional-staff-in-scope',
      status: 403,
      error: FORBIDDEN,
      allowedReads: ['staff-session'],
    },
  ],
  'scoped-staff': [
    {session: 'none', status: 401, error: UNAUTHORIZED, allowedReads: []},
    {
      session: 'participant',
      status: 401,
      error: UNAUTHORIZED,
      allowedReads: [],
    },
    {
      session: 'regional-staff-out-of-scope',
      status: 403,
      error: FORBIDDEN,
      // 'tournament-by-id' is `requireStaffForTournament()`'s scope read,
      // 'scope' `requireStaffForEntry()`'s.
      allowedReads: ['staff-session', 'scope', 'tournament-by-id'],
    },
  ],
  participant: [
    {session: 'none', status: 401, error: UNAUTHORIZED, allowedReads: []},
    {
      session: 'general-staff',
      status: 401,
      error: UNAUTHORIZED,
      allowedReads: [],
    },
  ],
  // The tournament the stub answers with is closed, so each of these is
  // someone a closed form is not for.
  'entry-period': [
    {
      session: 'none',
      status: 403,
      error: ENTRY_PERIOD_CLOSED,
      allowedReads: ['tournament-by-id', 'tournament-by-slug'],
    },
    {
      session: 'participant',
      status: 403,
      error: ENTRY_PERIOD_CLOSED,
      allowedReads: ['tournament-by-id', 'tournament-by-slug'],
    },
    {
      session: 'regional-staff-out-of-scope',
      status: 403,
      error: ENTRY_PERIOD_CLOSED,
      allowedReads: ['tournament-by-id', 'tournament-by-slug', 'staff-session'],
    },
  ],
};

/** A probe a route didn't refuse the way its policy says it must. */
interface Leak {
  route: string;
  method: string;
  session: Session;
  status: number;
  body: string;
  outboundRequests: string[];
}

/**
 * Lets everything a route handed to `waitUntil()`, and anything it started
 * without awaiting, run to completion, so a read made after the response is
 * counted against the route that made it rather than the next one.
 */
async function settle(pending: Array<Promise<unknown>>): Promise<void> {
  await Promise.allSettled(pending);
  await new Promise(resolve => setTimeout(resolve, 10));
}

/**
 * Sends every route of `hono` the probes its policy must refuse, and reports
 * each that wasn't refused for the right reason.
 *
 * Refused means the guard's own status and body -- 401 `unauthorized` / 403
 * `forbidden`, or 403 `entry period closed` from the entry-period gate --
 * with no read beyond the ones that guard makes. The status alone isn't
 * enough: a route can also answer 400 (validation, Turnstile), 429 (rate
 * limit) or 500 (a failed read), and each of those means the request got
 * past where the guard should have stopped it. To keep those other gates
 * from standing in for the guard, every request is one they let through:
 * the limiters allow everything, siteverify says yes to the Turnstile
 * header, the parameters are well formed, and the body is JSON (which
 * `hono/csrf` in `src/index.ts` leaves alone).
 *
 * @param policies The policy of every route; a route without one is
 *     reported as a leak of its own.
 */
async function findLeaks(
  hono: ApiApp,
  policies: Readonly<Record<string, Policy>>,
): Promise<Leak[]> {
  const leaks: Leak[] = [];
  for (const route of collectRoutes(hono).routes) {
    const policy = policies[routeKey(route)];
    if (!policy) {
      leaks.push({
        route: routeKey(route),
        method: route.method,
        session: 'none',
        status: 0,
        body: 'no policy declared for this route',
        outboundRequests: [],
      });
      continue;
    }
    if (policy.access === 'public') {
      continue;
    }
    const methods = route.method === 'ALL' ? ALL_METHODS : [route.method];
    for (const method of methods) {
      for (const probe of PROBES[policy.access]) {
        const leak = await runProbe(hono, route, method, probe);
        if (leak) leaks.push(leak);
      }
    }
  }
  return leaks;
}

async function runProbe(
  hono: ApiApp,
  route: Route,
  method: string,
  probe: Probe,
): Promise<Leak | null> {
  outboundRequests = [];
  const pending: Array<Promise<unknown>> = [];
  const executionCtx = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const cookie = await cookieFor(probe.session);
  const res = await hono.request(
    toConcretePath(route.path),
    {
      method,
      headers: {
        'cf-turnstile-response': TURNSTILE_TEST_TOKEN,
        ...(hasBody ? {'content-type': 'application/json'} : {}),
        ...(cookie ? {cookie} : {}),
      },
      ...(hasBody ? {body: '{}'} : {}),
    },
    TEST_ENV,
    executionCtx,
  );
  const body = await res.text();
  await settle(pending);
  const refused =
    res.status === probe.status &&
    body === JSON.stringify({error: probe.error});
  const unexpectedReads = outboundRequests.filter(
    ({read}) => !read || !probe.allowedReads.includes(read.kind),
  );
  if (refused && unexpectedReads.length === 0) {
    return null;
  }
  return {
    route: routeKey(route),
    method,
    session: probe.session,
    status: res.status,
    body,
    outboundRequests: outboundRequests.map(({url}) => url),
  };
}

/**
 * The rows of the endpoint table in `docs/api-endpoints.md` (section 2), as
 * routes with the text of their 認可 column.
 */
async function readDocumentedRoutes(): Promise<
  Array<Route & {authorization: string}>
> {
  const doc = await Bun.file(
    `${import.meta.dir}/../../../docs/api-endpoints.md`,
  ).text();
  const section = doc
    .split('\n## 2. エンドポイント一覧\n')[1]
    ?.split('\n## ')[0];
  if (section === undefined) {
    throw new Error('docs/api-endpoints.md has no endpoint table');
  }
  const rows = [];
  for (const line of section.split('\n')) {
    const match = /^\| (\w+) \| `([^`]+)` \| (.+) \|$/.exec(line);
    if (match) {
      rows.push({method: match[1], path: match[2], authorization: match[3]});
    }
  }
  return rows;
}

describe('route authorization coverage', () => {
  const {routes: registered, unrecognized} = collectRoutes(app);

  it('can see every registered route', () => {
    expect(unrecognized).toEqual([]);
  });

  it('refuses every probe its policy says it must', async () => {
    expect(await findLeaks(app, ROUTE_POLICIES)).toEqual([]);
  });

  it('declares a policy for exactly the registered routes', () => {
    expect(Object.keys(ROUTE_POLICIES).sort()).toEqual(
      registered.map(routeKey).sort(),
    );
  });

  it('agrees with the 認可 column of docs/api-endpoints.md', async () => {
    const documented = await readDocumentedRoutes();
    expect(documented.map(routeKey).sort()).toEqual(
      registered.map(routeKey).sort(),
    );
    for (const row of documented) {
      const access = DOCUMENTED_ACCESS.find(([pattern]) =>
        pattern.test(row.authorization),
      )?.[1];
      expect({route: routeKey(row), access}).toEqual({
        route: routeKey(row),
        access: ROUTE_POLICIES[routeKey(row)]?.access,
      });
    }
  });
});

// The checks above are only worth something if they can fail. These run
// them against small apps with a known answer, so a change that makes them
// pass everything (a filter that drops routes, a status it accepts) shows
// up here rather than as silence.
describe('route authorization coverage, tried on known mistakes', () => {
  /** A one-route app under `/api`, and a policy for its single route. */
  function appWith(build: (api: Hono<StaffEnv>) => Hono<StaffEnv>): ApiApp {
    const api = new Hono<Env>().basePath('/api');
    api.route('/', build(new Hono<StaffEnv>()));
    return api as unknown as ApiApp;
  }

  async function leakedSessions(
    hono: ApiApp,
    policies: Record<string, Policy>,
  ): Promise<string[]> {
    return (await findLeaks(hono, policies)).map(
      leak => `${leak.method} ${leak.session}`,
    );
  }

  it('reports a route whose guard is missing', async () => {
    const hono = appWith(api =>
      api
        .get('/guarded', requireGeneralStaff(), c => c.json({ok: true}))
        .get('/forgotten/:tournamentId', c => c.json({ok: true})),
    );
    const leaks = await findLeaks(hono, {
      'GET /api/guarded': {access: 'general-staff'},
      'GET /api/forgotten/:tournamentId': {access: 'general-staff'},
    });
    expect([...new Set(leaks.map(leak => leak.route))]).toEqual([
      'GET /api/forgotten/:tournamentId',
    ]);
  });

  it('reports a route that has no policy', async () => {
    const hono = appWith(api =>
      api.get('/new', requireGeneralStaff(), c => c.json({ok: true})),
    );
    expect(await findLeaks(hono, {})).toMatchObject([
      {route: 'GET /api/new', body: 'no policy declared for this route'},
    ]);
  });

  it('reports a route that reaches the database before refusing', async () => {
    const hono = appWith(api =>
      api.get(
        '/late',
        async (c, next) => {
          await fetch(`${c.env.SUPABASE_URL}/rest/v1/entries`);
          await next();
        },
        requireGeneralStaff(),
        c => c.json({ok: true}),
      ),
    );
    expect(
      await leakedSessions(hono, {'GET /api/late': {access: 'general-staff'}}),
    ).toEqual(['GET none', 'GET participant', 'GET regional-staff-in-scope']);
  });

  // The guard is there, but it is the wrong one.
  it('reports a staff route that a participant session gets through', async () => {
    const hono = appWith(api =>
      api.get('/staff-only', requireParticipant(), c => c.json({ok: true})),
    );
    expect(
      await leakedSessions(hono, {
        'GET /api/staff-only': {access: 'general-staff'},
      }),
    ).toContain('GET participant');
  });

  it('reports a 統括 route that an in-scope 地域スタッフ gets through', async () => {
    const hono = appWith(api =>
      api.get('/x/:tournamentId', requireStaffForTournament(), c =>
        c.json({ok: true}),
      ),
    );
    expect(
      await leakedSessions(hono, {
        'GET /api/x/:tournamentId': {access: 'general-staff'},
      }),
    ).toEqual(['GET regional-staff-in-scope']);
  });

  it('reports a form route that lost its entry-period gate', async () => {
    const hono = appWith(api =>
      api.get('/form/:tournamentId', c => c.json({ok: true})),
    );
    expect(
      await leakedSessions(hono, {
        'GET /api/form/:tournamentId': {access: 'entry-period'},
      }),
    ).toEqual([
      'GET none',
      'GET participant',
      'GET regional-staff-out-of-scope',
    ]);
  });

  it('accepts a form route behind its entry-period gate', async () => {
    const hono = new Hono<Env>().basePath('/api');
    hono.get(
      '/form/:tournamentId',
      requireOpenEntryPeriodOrStaff(byTournamentIdParam),
      c => c.json({ok: true}),
    );
    expect(
      await findLeaks(hono as unknown as ApiApp, {
        'GET /api/form/:tournamentId': {access: 'entry-period'},
      }),
    ).toEqual([]);
  });

  it('reports a read made after the response', async () => {
    // A guard that refuses, but only after handing a read to `waitUntil()`.
    const background = appWith(api =>
      api.get('/background', c => {
        c.executionCtx.waitUntil(
          new Promise(resolve => setTimeout(resolve, 1)).then(() =>
            fetch(`${c.env.SUPABASE_URL}/rest/v1/entries`),
          ),
        );
        return c.json({error: UNAUTHORIZED}, 401);
      }),
    );
    const policy = {'GET /api/background': {access: 'participant'}} as const;
    expect(await leakedSessions(background, policy)).toEqual([
      'GET none',
      'GET general-staff',
    ]);
  });

  it('tries every method on an .all() route', async () => {
    const hono = appWith(api =>
      api.all(
        '/any',
        async (c, next) => {
          // Guarded on GET only.
          if (c.req.method === 'GET') {
            return c.json({error: UNAUTHORIZED}, 401);
          }
          await next();
        },
        c => c.json({ok: true}),
      ),
    );
    const leaked = await leakedSessions(hono, {
      'ALL /api/any': {access: 'participant'},
    });
    expect(leaked).not.toContain('GET none');
    expect(leaked).toContain('POST none');
    expect(leaked).toContain('DELETE none');
  });

  it('reports a registration with no handler it can recognize', () => {
    const hono = appWith(api =>
      // A handler written with `next`, which only arity sets apart from
      // middleware.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the unused `next` is the point.
      api.get('/two-args', (c, _next) => c.json({ok: true})),
    );
    expect(collectRoutes(hono, []).unrecognized).toEqual(['GET /api/two-args']);
  });
});
