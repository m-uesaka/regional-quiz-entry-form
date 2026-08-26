// Every address and secret the end-to-end run wires together, in one
// place: `playwright.config.ts` builds the `wrangler dev` command from
// these, and the tests and the seeding talk to the same addresses.

// The service role key the Supabase CLI issues for a local stack. It is
// the same on every machine (it is printed by `supabase status`, and is
// not a credential for anything but a throwaway local database), so the
// tests run without any per-developer setup. `supabase status -o env`
// remains the source of truth: CI exports the key from it, and so can a
// developer whose CLI issues a different one.
const LOCAL_SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.' +
  'EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export const SUPABASE_URL =
  process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

export const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? LOCAL_SUPABASE_SERVICE_ROLE_KEY;

/** The port `wrangler dev` serves `apps/backend` on for the test run. */
export const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 8787);

// Served over HTTPS (`wrangler dev --local-protocol https`, behind a
// self-signed certificate) rather than plain HTTP, because both session
// cookies are set `Secure` — as they are in production. Playwright's API
// request context stores such a cookie but then declines to send it back
// over `http://`, so every authenticated step would fail against an
// `http://` backend for a reason the app does not actually have.
export const BACKEND_URL = `https://127.0.0.1:${BACKEND_PORT}`;

/** The port the Resend stub in `./mail-sink.ts` listens on. */
export const MAIL_SINK_PORT = Number(process.env.E2E_MAIL_SINK_PORT ?? 8788);

export const MAIL_SINK_URL = `http://127.0.0.1:${MAIL_SINK_PORT}`;

// Nothing is served here during an API-level run: the value only ends up
// as the origin of the `/verify?token=...` link inside the confirmation
// mail, which the tests parse the token out of. It becomes a real address
// once the flows are driven through the UI (see the follow-up issue in
// `README.md`).
export const FRONTEND_URL = 'http://127.0.0.1:5173';

/** The HS256 key the backend signs session JWTs with during the run. */
export const SESSION_SECRET = 'e2e-session-secret';

export const MAIL_FROM_ADDRESS = 'entry@example.test';
