import type {Handle, HandleFetch} from '@sveltejs/kit';
import {env} from '$env/dynamic/private';
import {readStaffClaims, STAFF_SESSION_COOKIE} from '$lib/server/staff-session';
import {
  PARTICIPANT_SESSION_COOKIE,
  readParticipantClaims,
} from '$lib/server/participant-session';
import {
  forwardBackendCookies,
  rewriteApiRequest,
} from '$lib/server/backend-fetch';

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
  if (!rewritten) return fetch(request);

  const response = await fetch(rewritten);
  // Only calls SvelteKit resolves internally get their `Set-Cookie` headers
  // applied to the page response for free; a rewritten one is cross-origin
  // by definition, so the session cookie a login answers with is carried
  // over by hand.
  forwardBackendCookies(response, event.cookies);
  return response;
};
