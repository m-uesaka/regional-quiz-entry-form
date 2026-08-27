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

// Plain HTTP. Nothing in the run talks to the Worker over TLS: the browser
// only ever reaches it through the frontend (`vite dev`'s `/api/*` proxy,
// and `handleFetch` during SSR), and the API calls left in `./api.ts` are
// all anonymous.
//
// It used to be HTTPS, because the session cookies are `Secure` — as they
// are in production — and Playwright's API request context declines to send
// such a cookie back over `http://`. Now that the sessions are held by the
// browser instead, under the frontend's own origin, that no longer applies,
// and a self-signed certificate would have to be waved through by every
// server-side `fetch` the SvelteKit app makes.
export const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

/** The port the Resend stub in `./mail-sink.ts` listens on. */
export const MAIL_SINK_PORT = Number(process.env.E2E_MAIL_SINK_PORT ?? 8788);

export const MAIL_SINK_URL = `http://127.0.0.1:${MAIL_SINK_PORT}`;

/** The port `vite dev` serves `apps/frontend` on for the test run. */
export const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 5173);

// Plain HTTP, unlike the backend: this is the origin the browser is pointed
// at, and it is also what the backend builds the `/verify?token=...` link
// in the confirmation mail from, so the two have to agree.
//
// The session cookies are re-issued by the frontend under its own origin
// (see `forwardSetCookies()` in `apps/frontend/src/lib/server`), which drops
// `Secure` when it is serving over HTTP, so they survive the hand-off that
// `BACKEND_URL` needs HTTPS for.
export const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

/** The HS256 key the backend signs session JWTs with during the run. */
export const SESSION_SECRET = 'e2e-session-secret';

export const MAIL_FROM_ADDRESS = 'entry@example.test';
