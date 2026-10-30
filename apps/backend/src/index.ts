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
import {staffEntryPauseRoute} from './routes/staff-entry-pause';
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
//     A frontend reached under another address (`127.0.0.1` in local dev, a
//     Pages preview) sends that address instead, so it has to be listed in
//     `CSRF_TRUSTED_ORIGINS`.
app.use('*', csrf({origin: (origin, c) => trustedOrigins(c.env).has(origin)}));

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
  .route('/staff', staffEntryPauseRoute)
  .route('/staff', staffMailRoute)
  .route('/staff', staffAccountsRoute)
  .route('/entries', entryVerificationRoute)
  .route('/form-definitions', formDefinitionsRoute)
  .route('/sheet-import', sheetImportRoute)
  .route('/mypage', mypageRoute)
  .route('/portal', portalRoute);

export type AppType = typeof routes;

/** The last `trustedOrigins()` answer, and the bindings it was read from. */
let trustedOriginsCache:
  {key: string; origins: ReadonlySet<string>} | undefined;

/**
 * The origins the CSRF check lets a form-like request come from:
 * `FRONTEND_URL` and whatever `CSRF_TRUSTED_ORIGINS` adds.
 *
 * Each is reduced to its origin, so a value written with a trailing slash or
 * a path still matches the `scheme://host[:port]` a browser sends. One that
 * is not a URL at all is left out rather than thrown on: a misconfigured
 * binding refuses form posts instead of letting every origin through.
 *
 * Parsed once and kept while the bindings say the same thing -- they are
 * fixed for an isolate's lifetime, so in practice that is once per isolate.
 * @param env The Worker's bindings.
 */
function trustedOrigins(env: Bindings): ReadonlySet<string> {
  const key = `${env.FRONTEND_URL}\n${env.CSRF_TRUSTED_ORIGINS ?? ''}`;
  if (trustedOriginsCache?.key !== key) {
    const origins = new Set<string>();
    for (const value of [
      env.FRONTEND_URL,
      ...(env.CSRF_TRUSTED_ORIGINS ?? '').split(','),
    ]) {
      try {
        origins.add(new URL(value.trim()).origin);
      } catch {
        // Not a URL; see above.
      }
    }
    trustedOriginsCache = {key, origins};
  }
  return trustedOriginsCache.origins;
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
