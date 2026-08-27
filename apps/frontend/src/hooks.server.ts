import type {Handle, HandleFetch} from '@sveltejs/kit';
import {env} from '$env/dynamic/private';
import {readStaffClaims} from '$lib/server/staff-session';
import {readParticipantClaims} from '$lib/server/participant-session';
import {rewriteApiRequest} from '$lib/server/backend-fetch';

// Matches `STAFF_SESSION_COOKIE` in
// `apps/backend/src/middleware/staff-auth.ts`.
const STAFF_SESSION_COOKIE = 'staff_session';
// Matches `PARTICIPANT_SESSION_COOKIE` in
// `apps/backend/src/middleware/participant-auth.ts`.
const PARTICIPANT_SESSION_COOKIE = 'participant_session';

export const handle: Handle = async ({event, resolve}) => {
  // `$env/dynamic/private` first, for the same reason `handleFetch` below
  // reads `BACKEND_URL` from it: `event.platform` only exists on Cloudflare,
  // so reading the secret from there alone left every session unrecognized
  // under `vite dev` — and a `/staff/*` page that can't see the session it
  // just issued redirects straight back to the login screen. The platform
  // binding stays as a fallback so a deployment that only sets the secret as
  // a Worker secret keeps working.
  const sessionSecret =
    env.SESSION_SECRET ?? event.platform?.env?.SESSION_SECRET;
  event.locals.staff = await readStaffClaims(
    event.cookies.get(STAFF_SESSION_COOKIE),
    sessionSecret,
  );
  event.locals.participant = await readParticipantClaims(
    event.cookies.get(PARTICIPANT_SESSION_COOKIE),
    sessionSecret,
  );
  return resolve(event);
};

// `$env/dynamic/private` is read here rather than `event.platform.env` so the
// same code works under `vite dev` (where it comes from `.env`) and on
// Cloudflare (where `adapter-cloudflare`'s worker hands the Worker's `env` to
// `server.init()`).
export const handleFetch: HandleFetch = async ({event, request, fetch}) => {
  const rewritten = rewriteApiRequest({
    request,
    frontendUrl: event.url,
    backendUrl: env.BACKEND_URL,
    cookie: event.request.headers.get('cookie'),
  });
  return fetch(rewritten ?? request);
};
