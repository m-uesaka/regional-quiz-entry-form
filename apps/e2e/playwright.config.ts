import {defineConfig, devices} from '@playwright/test';
import {
  BACKEND_PORT,
  BACKEND_URL,
  FRONTEND_PORT,
  FRONTEND_URL,
  MAIL_FROM_ADDRESS,
  MAIL_SINK_URL,
  SESSION_SECRET,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  TURNSTILE_SECRET_KEY,
  TURNSTILE_SITE_KEY,
} from './support/env';

// The bindings `apps/backend` reads (`src/types/env.ts`), passed to
// `wrangler dev` on the command line rather than through a `.dev.vars`
// file so that a test run never overwrites whatever a developer keeps
// there. Wrangler splits each `--var` on its first colon, so a URL value
// survives intact.
const BACKEND_VARS: Record<string, string> = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SESSION_SECRET,
  MAIL_FROM_ADDRESS,
  FRONTEND_URL,
  // Points every send at the stub in `support/mail-sink.ts`.
  MAIL_API_BASE_URL: MAIL_SINK_URL,
  // Never reaches a real provider, but the binding has to be present.
  MAIL_API_KEY: 'e2e-mail-api-key',
  // Only the Task 2-3 spreadsheet import reads this, which no spec here
  // exercises.
  GOOGLE_SHEETS_API_KEY: 'e2e-google-sheets-api-key',
  // Accepts any token, so the widget the browser solves is verified for
  // real without a real Turnstile account behind it.
  TURNSTILE_SECRET_KEY,
};

// `apps/frontend` reads both of these through `$env/dynamic/private`, which
// under `vite dev` is `process.env` merged over the package's own `.env` —
// so passing them here overrides whatever a developer keeps in that file.
// `vite.config.ts` reads `BACKEND_URL` the same way for its `/api/*` dev
// proxy, which is what carries the browser's own calls (the CSV download
// link) to the Worker.
const FRONTEND_ENV: Record<string, string> = {
  BACKEND_URL,
  // Must match the backend's, or `hooks.server.ts` fails to verify the
  // session cookies it is handed and every `/staff/*` page bounces back to
  // the login screen.
  SESSION_SECRET,
  // Turns off certificate verification for this `vite dev` process — and
  // only for it: Playwright passes this to the server it spawns here, not
  // to the developer's shell.
  //
  // `handleFetch` in `apps/frontend/src/hooks.server.ts` forwards every SSR
  // `/api/*` call with the runtime's own `fetch`, which has no per-request
  // way to accept the self-signed certificate `wrangler dev
  // --local-protocol https` presents. Without this, every such call throws
  // (`DEPTH_ZERO_SELF_SIGNED_CERT` under node, `self signed certificate`
  // under bun) and every page renders as a 500. The browser's own `/api/*`
  // calls are unaffected: they go through `vite.config.ts`'s dev proxy,
  // which already sets `secure: false`.
  NODE_TLS_REJECT_UNAUTHORIZED: '0',
  // The other half of the pair above. Read through `$env/dynamic/public` by
  // `$lib/components/Turnstile.svelte`; without it the two forms behind the
  // challenge render no widget, send no token, and are refused by the
  // Worker.
  PUBLIC_TURNSTILE_SITE_KEY: TURNSTILE_SITE_KEY,
};

const frontendCommand = [
  'bunx vite dev',
  `--port ${FRONTEND_PORT}`,
  // `--strictPort` so a developer's own `vite dev` on 5173 makes this fail
  // loudly rather than have the tests silently drive that server instead,
  // which would be pointed at their `.env` rather than at `FRONTEND_ENV`.
  '--strictPort',
  '--host 127.0.0.1',
].join(' ');

const backendCommand = [
  'bunx wrangler dev',
  `--port ${BACKEND_PORT}`,
  '--ip 127.0.0.1',
  // Serves the Worker over TLS behind a self-signed certificate wrangler
  // generates, so the session cookies it sets travel the way they do in
  // production. `BACKEND_URL` in `support/env.ts` names the same scheme.
  '--local-protocol https',
  '--show-interactive-dev-session false',
  ...Object.entries(BACKEND_VARS).map(
    ([key, value]) => `--var ${key}:${value}`,
  ),
].join(' ');

// Playwright requires the config module to default-export the config,
// which is why this file breaks the "named exports only" rule.
export default defineConfig({
  testDir: './tests',
  globalSetup: './support/global-setup.ts',
  // Every spec shares one Supabase database, and the waitlist spec depends
  // on the seat count of its tournament, so the specs are run one at a
  // time rather than raced against each other.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // On CI the HTML report is what `.github/workflows/ci.yml` uploads as
  // the `playwright-report` artifact when the job fails, so it has to be
  // written to that default output folder instead of being served.
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', {open: 'never'}]]
    : [['list']],
  timeout: 60_000,
  use: {
    // The specs drive the SvelteKit app, so a bare path in `page.goto()` —
    // and in `expect(page).toHaveURL()` — is a frontend route. The few API
    // calls left (reading the mail stub, arranging a roster for the staff
    // spec) name their origin in full, so they are unaffected.
    baseURL: FRONTEND_URL,
    // The `request` fixture in `support/api.ts` calls the Worker directly,
    // so it meets the same self-signed certificate the frontend does. The
    // browser never does — it only ever talks to `vite dev` over plain HTTP
    // — but the flag is set on `use`, which covers both contexts.
    ignoreHTTPSErrors: true,
    // Attached to the HTML report CI uploads when the job fails, which for
    // a browser-driven run is the difference between a readable failure and
    // a line number.
    trace: 'retain-on-failure',
  },
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
  webServer: [
    {
      command: 'bun run support/mail-sink.ts',
      url: `${MAIL_SINK_URL}/healthz`,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: backendCommand,
      cwd: '../backend',
      url: `${BACKEND_URL}/api/healthz`,
      // This readiness probe is made by Playwright itself rather than by a
      // context `use` applies to, so it needs the certificate waved through
      // separately.
      ignoreHTTPSErrors: true,
      // Never reused: an already running Worker on this port would be
      // started from a developer's own `.dev.vars`, so it could point at
      // remote Supabase data or a real mail provider instead of the
      // bindings in `BACKEND_VARS`. Failing on a port conflict is safer.
      reuseExistingServer: false,
      // A cold `wrangler dev` has to build the Worker before it answers.
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: frontendCommand,
      cwd: '../frontend',
      url: FRONTEND_URL,
      env: FRONTEND_ENV,
      // Never reused, for the same reason as the backend: an already
      // running `vite dev` would be reading a developer's own `.env` and so
      // could be pointed at a different backend entirely. `--strictPort`
      // above turns that into a startup failure rather than a silent
      // mis-run.
      reuseExistingServer: false,
      // A cold start has to sync SvelteKit's generated types and compile the
      // route the health check asks for.
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
