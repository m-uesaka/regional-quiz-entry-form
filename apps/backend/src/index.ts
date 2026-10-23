import {Hono} from 'hono';
import {csrf} from 'hono/csrf';
import {secureHeaders} from 'hono/secure-headers';
import type {Bindings, Env} from './types/env';
import {handleBulkMailQueue, type BulkMailMessage} from './lib/bulk-mail-queue';
import {staffAuthRoute} from './routes/staff-auth';
import {participantAuthRoute} from './routes/participant-auth';
import {passwordResetRoute} from './routes/password-reset';
import {regionsRoute} from './routes/regions';
import {tournamentsRoute} from './routes/tournaments';
import {entriesRoute, entrySessionRoute} from './routes/entries';
import {entryListRoute} from './routes/entry-list';
import {regulationsRoute} from './routes/regulations';
import {staffEntriesRoute} from './routes/staff-entries';
import {staffDashboardRoute} from './routes/staff-dashboard';
import {staffMailRoute} from './routes/staff-mail';
import {staffAccountsRoute} from './routes/staff-accounts';
import {entryVerificationRoute} from './routes/entry-verification';
import {formDefinitionsRoute} from './routes/form-definitions';
import {sheetImportRoute} from './routes/sheet-import';
import {mypageRoute} from './routes/mypage';
import {portalRoute} from './routes/portal';

// Exported by name for the tests, which drive the API through
// `app.request()`. The default export below is the Worker itself, and it is
// no longer this object: a Worker with a queue consumer has to export the
// `queue` handler alongside `fetch`.
export const app = new Hono<Env>().basePath('/api');

// Every response, the API's own errors included: registered first, so it
// still sees the 403 the origin check below answers with.
app.use('*', secureHeaders());

// The origin check for state-changing requests (#120). Until this was here,
// cross-site form posts were kept out by two things nobody had written down:
// the session cookies are `SameSite=Lax`, and no route answers with CORS
// headers. Either could stop being true without a word -- a `cors()` added
// for some other reason, a cookie that has to become `SameSite=None` -- so
// the dependency is stated here instead of left implicit.
//
// `hono/csrf` checks the requests a browser lets a foreign page send without
// a preflight: a non-GET/HEAD/OPTIONS whose `Content-Type` is one a plain
// `<form>` can produce (or none at all). Those pass only when
// `Sec-Fetch-Site` says `same-origin` or `Origin` is the frontend's. A JSON
// body is not checked here, because a browser can only send one cross-site
// after a CORS preflight, which this API never answers -- so adding `cors()`
// later still means deciding which origins it trusts.
//
// The legitimate callers all pass:
//   - The browser's own `/api/*` calls reach the Worker through the route on
//     the frontend host (or `vite dev`'s proxy), i.e. same-origin.
//   - SSR calls from `load`s and actions are forwarded by the frontend's
//     `handleFetch`, and SvelteKit's server-side `fetch` puts the page's own
//     origin -- which is `FRONTEND_URL` -- in `Origin` before it sends them.
app.use('*', csrf({origin: (origin, c) => isFrontendOrigin(origin, c.env)}));

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only read via `typeof routes` below for the Hono RPC AppType export.
const routes = app
  .get('/healthz', c => c.json({ok: true}))
  .route('/auth/staff', staffAuthRoute)
  .route('/auth/participant', participantAuthRoute)
  .route('/auth/participant/password-reset', passwordResetRoute)
  .route('/regions', regionsRoute)
  .route('/tournaments', entryListRoute)
  // Mounted before `tournamentsRoute` on purpose: its public
  // `/:regionSlug/:tournamentSlug` route also matches two segments, and its
  // `zValidator` would answer `/:tournamentId/regulations` with a 400
  // before this handler ever ran.
  .route('/tournaments', regulationsRoute)
  .route('/tournaments', tournamentsRoute)
  .route('/tournaments', entriesRoute)
  .route('/tournaments', entrySessionRoute)
  .route('/staff', staffDashboardRoute)
  .route('/staff', staffEntriesRoute)
  .route('/staff', staffMailRoute)
  .route('/staff', staffAccountsRoute)
  .route('/entries', entryVerificationRoute)
  .route('/form-definitions', formDefinitionsRoute)
  .route('/sheet-import', sheetImportRoute)
  .route('/mypage', mypageRoute)
  .route('/portal', portalRoute);

export type AppType = typeof routes;

/**
 * Whether a request's `Origin` is the frontend this Worker serves.
 *
 * Compared as an origin rather than as the raw binding, so a `FRONTEND_URL`
 * written with a trailing slash or a path still matches the
 * `scheme://host[:port]` a browser sends.
 *
 * @param origin The request's `Origin` header.
 * @param env The Worker's bindings.
 * @return `false` as well when `FRONTEND_URL` is not a URL at all: a
 *     misconfigured binding refuses form posts rather than letting every
 *     origin through.
 */
function isFrontendOrigin(origin: string, env: Bindings): boolean {
  try {
    return origin === new URL(env.FRONTEND_URL).origin;
  } catch {
    return false;
  }
}

// The Worker's entry points. `fetch` answers the HTTP API as before;
// `queue` is the consumer of the bulk mail queue declared in
// `wrangler.toml` (Task 10-4), which is what does the sending now that the
// staff bulk mail route only enqueues its recipients.
export default {
  fetch: app.fetch,
  // Wrapped rather than passed straight through: `handleBulkMailQueue()`
  // takes pacing overrides as its third argument, where the runtime hands
  // the consumer an `ExecutionContext`.
  queue: (batch, env) => handleBulkMailQueue(batch, env),
} satisfies ExportedHandler<Bindings, BulkMailMessage>;
