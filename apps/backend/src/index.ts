import {Hono} from 'hono';
import type {Env} from './types/env';
import {staffAuthRoute} from './routes/staff-auth';
import {participantAuthRoute} from './routes/participant-auth';
import {passwordResetRoute} from './routes/password-reset';
import {tournamentsRoute} from './routes/tournaments';
import {entriesRoute} from './routes/entries';
import {entryListRoute} from './routes/entry-list';
import {staffEntriesRoute} from './routes/staff-entries';
import {staffMailRoute} from './routes/staff-mail';
import {entryVerificationRoute} from './routes/entry-verification';
import {formDefinitionsRoute} from './routes/form-definitions';
import {sheetImportRoute} from './routes/sheet-import';
import {mypageRoute} from './routes/mypage';

const app = new Hono<Env>().basePath('/api');

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only read via `typeof routes` below for the Hono RPC AppType export.
const routes = app
  .get('/healthz', c => c.json({ok: true}))
  .route('/auth/staff', staffAuthRoute)
  .route('/auth/participant', participantAuthRoute)
  .route('/auth/participant/password-reset', passwordResetRoute)
  .route('/tournaments', entryListRoute)
  .route('/tournaments', tournamentsRoute)
  .route('/tournaments', entriesRoute)
  .route('/staff', staffEntriesRoute)
  .route('/staff', staffMailRoute)
  .route('/entries', entryVerificationRoute)
  .route('/form-definitions', formDefinitionsRoute)
  .route('/sheet-import', sheetImportRoute)
  .route('/mypage', mypageRoute);

export type AppType = typeof routes;
export default app;
