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

// HTTPS, so the run exercises the deployed topology: in production the
// frontend Worker reaches the backend Worker over TLS, and the session
// cookies the backend sets are marked `Secure` unconditionally
// (`secure: true` in `apps/backend/src/routes/*-auth.ts`) — an attribute
// that only describes the hop it was actually set over.
//
// `playwright.config.ts` starts `wrangler dev --local-protocol https` to
// match. Wrangler's certificate is self-signed, so each of the three sides
// that meets it has to be told to accept it; the comments there say which
// and why.
export const BACKEND_URL = `https://127.0.0.1:${BACKEND_PORT}`;

/** The port the Resend stub in `./mail-sink.ts` listens on. */
export const MAIL_SINK_PORT = Number(process.env.E2E_MAIL_SINK_PORT ?? 8788);

export const MAIL_SINK_URL = `http://127.0.0.1:${MAIL_SINK_PORT}`;

/** The port `vite dev` serves `apps/frontend` on for the test run. */
export const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 5173);

// The origin the browser is pointed at, and also what the backend builds the
// `/verify?token=...` link in the confirmation mail from, so the two have to
// agree.
//
// Both session cookies reach the browser the same way -- SvelteKit's cookie
// jar, filled by `forwardBackendCookies()`
// (`apps/frontend/src/lib/server/backend-fetch.ts`, called from
// `handleFetch`), which decides `Secure` from the frontend's own protocol
// rather than copying the backend's. Over plain HTTP the flag is therefore
// dropped and the cookies are accepted, loopback or not.
export const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

/** The HS256 key the backend signs session JWTs with during the run. */
export const SESSION_SECRET = 'e2e-session-secret';

export const MAIL_FROM_ADDRESS = 'entry@example.test';

// Cloudflare's published Turnstile testing keys (#116). The site key renders
// a widget that solves itself without any interaction, and the secret key
// makes siteverify accept whatever token it is given, so the entry form and
// the password-reset request form can be driven exactly as a participant
// would drive them.
//
// They are a real pair against the real service: the widget's script is
// fetched from `challenges.cloudflare.com` by the browser, and the Worker
// verifies the token against the same host. A test run therefore needs to be
// able to reach it — see `README.md`.
export const TURNSTILE_SITE_KEY = '1x00000000000000000000AA';

export const TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
