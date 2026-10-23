import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {Hono} from 'hono';
import {inspectRoutes} from 'hono/dev';
import type {Bindings, Env, StaffEnv} from './types/env';
import {app} from './index';
import {requireGeneralStaff} from './middleware/staff-auth';
import {
  PERMISSIVE_PLATFORM_BINDINGS,
  TURNSTILE_TEST_TOKEN,
  turnstileAwareFetch,
} from './test-support/bindings';

/** A route as `METHOD /path`, the way Hono registered it. */
interface Route {
  method: string;
  path: string;
}

/** A route that answers a request with no session, and why it may. */
interface PublicRoute extends Route {
  reason: string;
}

/**
 * 無認証で到達してよいルートの許可リスト。ここに無いルートは、セッション
 * 無しのリクエストに対して必ず 401 か 403 を返さなければならない。
 *
 * 認可はすべて Worker のミドルウェアが担っている(DB は service_role で
 * 触っており RLS はバイパスされる。`docs/database-schema.md` 4 章)ため、
 * ミドルウェアの付け忘れを止める仕組みが他に無い。ルートを足したらここに
 * 公開と書くか、認証を付けるかの二択になる。ここに足すときは
 * `docs/api-endpoints.md` 2 章の表の「認可」列も「なし」で始めること(下の
 * テストが両者の一致を確かめる)。
 *
 * 「期間中はなし」のルートは `requireOpenEntryPeriodOrStaff()` の後ろに
 * あり、期間外はスタッフに限られるが、期間中は誰でも読めるのでここに載る。
 */
const PUBLIC_ROUTES: readonly PublicRoute[] = [
  {method: 'GET', path: '/api/healthz', reason: 'ヘルスチェック'},
  {method: 'POST', path: '/api/auth/staff/login', reason: 'ログイン'},
  {
    method: 'POST',
    path: '/api/auth/staff/password-reset/confirm',
    reason: 'トークンで認可する',
  },
  {method: 'POST', path: '/api/auth/staff/logout', reason: 'Cookie を消すだけ'},
  {method: 'POST', path: '/api/auth/participant/login', reason: 'ログイン'},
  {
    method: 'POST',
    path: '/api/auth/participant/logout',
    reason: 'Cookie を消すだけ',
  },
  {
    method: 'POST',
    path: '/api/auth/participant/password-reset/request',
    reason: 'レート制限 + Turnstile。応答は登録の有無によらず同じ',
  },
  {
    method: 'POST',
    path: '/api/auth/participant/password-reset/confirm',
    reason: 'トークンで認可する',
  },
  {
    method: 'GET',
    path: '/api/tournaments/:tournamentId/entry-list',
    reason: '公開エントリーリスト(掲載名・ステータス・順位のみ)',
  },
  {
    method: 'GET',
    path: '/api/tournaments/:regionSlug/:tournamentSlug/entry-list',
    reason: '公開エントリーリスト(掲載名・ステータス・順位のみ)',
  },
  {
    method: 'GET',
    path: '/api/tournaments/:tournamentId/regulations',
    reason: 'エントリーフォームの描画用。期間外はスタッフのみ',
  },
  {
    method: 'GET',
    path: '/api/tournaments/:regionSlug/:tournamentSlug',
    reason: 'エントリーフォームの描画用。期間外はスタッフのみ',
  },
  {
    method: 'POST',
    path: '/api/tournaments/:tournamentId/entries',
    reason: '未ログインのエントリー。レート制限 + Turnstile',
  },
  {
    method: 'GET',
    path: '/api/entries/verify',
    reason: 'メール確認トークンで認可する',
  },
  {
    method: 'GET',
    path: '/api/form-definitions/:tournamentId',
    reason: 'エントリーフォームの描画用。期間外はスタッフのみ',
  },
  {
    method: 'GET',
    path: '/api/portal/tournaments',
    reason: 'ポータル(大会名・スラッグ・受付期間のみ)',
  },
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
 * The (method, path) of every handler registered on `hono`, once each.
 *
 * `app.routes` lists middleware too: a `.use('*', ...)` as an `ALL` entry,
 * and every per-route guard and validator as an entry of its own under the
 * route's method and path. `inspectRoutes()` marks the middleware (by
 * arity: a handler takes `c` only, middleware takes `c, next`), so what's
 * left is one entry per route a request can actually end up at.
 */
function collectHandlerRoutes(hono: ApiApp): Route[] {
  const seen = new Map<string, Route>();
  for (const {method, path, isMiddleware} of inspectRoutes(hono)) {
    if (isMiddleware) {
      continue;
    }
    const route = {method, path};
    seen.set(routeKey(route), route);
  }
  return [...seen.values()];
}

// Any well-formed UUID will do: no request below is meant to get as far as
// looking it up.
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

/** Every outbound request a route made, other than Turnstile's siteverify. */
let outboundRequests: string[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  outboundRequests = [];
  // Siteverify says yes, so a challenge in front of a guard can't be the
  // reason a request is refused. Anything else -- Supabase above all -- is
  // recorded and refused: a refusal for want of a session is decided from
  // the (absent) cookie alone, so reaching the database means the guard is
  // missing or comes too late. It is refused with a 400 rather than a
  // network error, which `supabase-js` would retry with a backoff long
  // enough to time the test out before it could say which route it was.
  globalThis.fetch = turnstileAwareFetch(((input: RequestInfo | URL) => {
    outboundRequests.push(input.toString());
    return Promise.resolve(
      Response.json(
        {message: 'no outbound request is expected'},
        {status: 400},
      ),
    );
  }) as typeof fetch);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** A route that let a request with no session through, and how far. */
interface Leak {
  route: string;
  status: number;
  body: string;
  outboundRequests: string[];
}

/**
 * Sends every handler route of `hono` that isn't in `publicRoutes` a request
 * with no session cookie, and reports the ones that weren't refused for it.
 *
 * Refused for it means a 401 `unauthorized` or 403 `forbidden` from the
 * guards (`middleware/staff-auth.ts`, `middleware/participant-auth.ts`),
 * with nothing sent anywhere first. The status alone isn't enough: a route
 * can also answer 400 (validation, Turnstile), 403 (`entry period closed`),
 * 429 (rate limit) or 500 (a failed read) -- and each of those means the
 * request got past where the guard should have stopped it. To keep those
 * other gates from standing in for the guard, every request is one they
 * let through: the limiters allow everything, siteverify says yes to the
 * Turnstile header, the parameters are well formed, and the body is JSON
 * (which `hono/csrf` leaves alone).
 */
async function findUnguardedRoutes(
  hono: ApiApp,
  publicRoutes: readonly Route[],
): Promise<Leak[]> {
  const publicKeys = new Set(publicRoutes.map(routeKey));
  const leaks: Leak[] = [];
  for (const route of collectHandlerRoutes(hono)) {
    if (publicKeys.has(routeKey(route))) {
      continue;
    }
    outboundRequests = [];
    // An `.all()` route answers any method; one is enough to find its guard.
    const method = route.method === 'ALL' ? 'GET' : route.method;
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const res = await hono.request(
      toConcretePath(route.path),
      {
        method,
        headers: {
          'cf-turnstile-response': TURNSTILE_TEST_TOKEN,
          ...(hasBody ? {'content-type': 'application/json'} : {}),
        },
        ...(hasBody ? {body: '{}'} : {}),
      },
      TEST_ENV,
    );
    const body = await res.text();
    const refused =
      (res.status === 401 && body === '{"error":"unauthorized"}') ||
      (res.status === 403 && body === '{"error":"forbidden"}');
    if (!refused || outboundRequests.length > 0) {
      leaks.push({
        route: routeKey(route),
        status: res.status,
        body,
        outboundRequests: [...outboundRequests],
      });
    }
  }
  return leaks;
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
  const registered = collectHandlerRoutes(app);

  it('has no route missing from either the allow list or the auth check', async () => {
    expect(await findUnguardedRoutes(app, PUBLIC_ROUTES)).toEqual([]);
  });

  it('has no stale entry in the allow list', () => {
    const registeredKeys = registered.map(routeKey);
    for (const route of PUBLIC_ROUTES) {
      expect(registeredKeys).toContain(routeKey(route));
    }
  });

  it('the allow list matches the 認証 column of docs/api-endpoints.md', async () => {
    const documented = await readDocumentedRoutes();
    // Every registered route is in the table and nothing else is, so a new
    // route can't skip the column...
    expect(documented.map(routeKey).sort()).toEqual(
      registered.map(routeKey).sort(),
    );
    // ...and the routes the table calls unauthenticated (なし, or なし while
    // the entry period is open) are exactly the allow list.
    expect(
      documented
        .filter(({authorization}) => /^(期間中は)?なし/.test(authorization))
        .map(routeKey)
        .sort(),
    ).toEqual(PUBLIC_ROUTES.map(routeKey).sort());
  });

  // The check above is only worth something if it can fail. These run it
  // against small apps with a known answer, so a change to it that makes it
  // pass everything (a filter that drops the routes, a status it accepts)
  // shows up here rather than as silence.
  it('reports a route whose guard is missing', async () => {
    const unguarded = new Hono<Env>().basePath('/api');
    unguarded.route(
      '/',
      new Hono<StaffEnv>()
        .get('/guarded', requireGeneralStaff(), c => c.json({ok: true}))
        .get('/forgotten/:tournamentId', c => c.json({ok: true})),
    );
    const leaks = await findUnguardedRoutes(unguarded, []);
    expect(leaks.map(leak => leak.route)).toEqual([
      'GET /api/forgotten/:tournamentId',
    ]);
  });

  it('reports a route that reaches the database before refusing', async () => {
    const lateGuard = new Hono<Env>().basePath('/api');
    lateGuard.route(
      '/',
      new Hono<StaffEnv>().get(
        '/late',
        async (c, next) => {
          await fetch(`${c.env.SUPABASE_URL}/rest/v1/entries`);
          await next();
        },
        requireGeneralStaff(),
        c => c.json({ok: true}),
      ),
    );
    const leaks = await findUnguardedRoutes(lateGuard, []);
    expect(leaks).toEqual([
      {
        route: 'GET /api/late',
        status: 401,
        body: '{"error":"unauthorized"}',
        outboundRequests: ['http://supabase.invalid/rest/v1/entries'],
      },
    ]);
  });
});
