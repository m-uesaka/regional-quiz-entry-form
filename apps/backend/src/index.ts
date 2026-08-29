import {Hono} from 'hono';
import type {Bindings, Env} from './types/env';
import {handleBulkMailQueue, type BulkMailMessage} from './lib/bulk-mail-queue';
import {staffAuthRoute} from './routes/staff-auth';
import {participantAuthRoute} from './routes/participant-auth';
import {passwordResetRoute} from './routes/password-reset';
import {regionsRoute} from './routes/regions';
import {tournamentsRoute} from './routes/tournaments';
import {entriesRoute} from './routes/entries';
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

// Exported by name for the tests, which drive the API through
// `app.request()`. The default export below is the Worker itself, and it is
// no longer this object: a Worker with a queue consumer has to export the
// `queue` handler alongside `fetch`.
export const app = new Hono<Env>().basePath('/api');

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
  .route('/staff', staffDashboardRoute)
  .route('/staff', staffEntriesRoute)
  .route('/staff', staffMailRoute)
  .route('/staff', staffAccountsRoute)
  .route('/entries', entryVerificationRoute)
  .route('/form-definitions', formDefinitionsRoute)
  .route('/sheet-import', sheetImportRoute)
  .route('/mypage', mypageRoute);

export type AppType = typeof routes;

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
