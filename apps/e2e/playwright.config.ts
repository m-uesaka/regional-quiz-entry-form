import {defineConfig} from '@playwright/test';
import {
  BACKEND_PORT,
  BACKEND_URL,
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

const backendCommand = [
  'bunx wrangler dev',
  `--port ${BACKEND_PORT}`,
  '--ip 127.0.0.1',
  '--show-interactive-dev-session false',
  // See `BACKEND_URL` in `support/env.ts`: the session cookies are
  // `Secure`, so they only travel over HTTPS.
  '--local-protocol https',
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
  timeout: 30_000,
  use: {
    // Every spec talks to the backend directly: the flows they cover have
    // no UI yet (see this package's README), so no browser is launched and
    // none has to be installed.
    baseURL: BACKEND_URL,
    // `wrangler dev --local-protocol https` serves a self-signed
    // certificate.
    ignoreHTTPSErrors: true,
  },
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
      ignoreHTTPSErrors: true,
      reuseExistingServer: !process.env.CI,
      // A cold `wrangler dev` has to build the Worker before it answers.
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
