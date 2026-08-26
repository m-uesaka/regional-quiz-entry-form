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
  event.locals.staff = await readStaffClaims(
    event.cookies.get(STAFF_SESSION_COOKIE),
    event.platform?.env?.SESSION_SECRET,
  );
  event.locals.participant = await readParticipantClaims(
    event.cookies.get(PARTICIPANT_SESSION_COOKIE),
    event.platform?.env?.SESSION_SECRET,
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
