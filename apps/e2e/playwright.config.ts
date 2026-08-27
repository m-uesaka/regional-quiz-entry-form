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
