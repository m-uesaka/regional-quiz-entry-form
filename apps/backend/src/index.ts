import {Hono} from 'hono';
import type {Env} from './types/env';
import {staffAuthRoute} from './routes/staff-auth';

const app = new Hono<Env>().basePath('/api');

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- only read via `typeof routes` below for the Hono RPC AppType export.
const routes = app
  .get('/healthz', c => c.json({ok: true}))
  .route('/auth/staff', staffAuthRoute);
// 以降のタスクで .route('/tournaments', tournamentsRoute) のようにチェーンしていく

export type AppType = typeof routes;
export default app;
