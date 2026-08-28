import {verify} from 'hono/jwt';
import {redirect, type Cookies} from '@sveltejs/kit';
import {
  ParticipantClaimsSchema,
  type ParticipantClaims,
} from '@regional-quiz/shared';

/**
 * Matches `PARTICIPANT_SESSION_COOKIE` in
 * `apps/backend/src/middleware/participant-auth.ts`.
 */
export const PARTICIPANT_SESSION_COOKIE = 'participant_session';

/** Where a participant without a usable session is sent. */
export const PARTICIPANT_LOGIN_PATH = '/mypage/login';

/**
 * Verifies and parses the `participant_session` JWT issued by the backend
 * on participant login. Mirrors
 * `apps/backend/src/middleware/participant-auth.ts`'s private
 * `readParticipantId()` so the frontend recognizes the same session cookie
 * the backend does.
 *
 * @param token The raw `participant_session` cookie value, if present.
 * @param secret The `SESSION_SECRET` used to sign the token. May be
 *     `undefined` outside a real Cloudflare context (e.g. local `vite dev`
 *     or tests), in which case this always resolves to `null`.
 * @return The parsed claims, or `null` if the token is missing, invalid,
 *     expired, or doesn't match the expected shape.
 */
export async function readParticipantClaims(
  token: string | undefined,
  secret: string | undefined,
): Promise<ParticipantClaims | null> {
  if (!token || !secret) return null;
  try {
    const payload = await verify(token, secret, 'HS256');
    // hono/jwt's `verify()` only checks expiration when an `exp` claim is
    // present, so a correctly signed token without one would otherwise be
    // treated as a valid session indefinitely.
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as Record<string, unknown>).exp !== 'number'
    ) {
      return null;
    }
    return ParticipantClaimsSchema.parse(payload);
  } catch {
    // Covers both an invalid/expired signature (thrown by `verify`) and
    // claims that don't match the expected shape (thrown by `.parse`).
    return null;
  }
}

/**
 * Drops the session cookie the browser is still holding.
 *
 * The `path` matches the one the backend issues the cookie under, since a
 * delete only matches a cookie of the same name *and* path.
 *
 * @param cookies `event.cookies`.
 */
export function clearParticipantSession(cookies: Cookies): void {
  cookies.delete(PARTICIPANT_SESSION_COOKIE, {path: '/'});
}

/**
 * Sends a participant whose session the API has just refused to the login
 * form, dropping the dead cookie on the way.
 *
 * Clearing it is what keeps the two ends from disagreeing forever.
 * `readParticipantClaims` can only check the signature and the expiry, but
 * the backend also cuts a session whose password has been reset since it was
 * issued, and one whose participant is gone (see `requireParticipant()` in
 * `apps/backend/src/middleware/participant-auth.ts`). A cookie this app
 * still reads as valid can therefore be dead as far as the API is concerned
 * — and left in place it would bounce the participant between
 * `/mypage/login` (which redirects a "logged-in" visitor to `/mypage`) and
 * `/mypage` (which redirects a refused one back here) until the browser
 * gives up.
 *
 * @param cookies `event.cookies`.
 */
export function redirectToParticipantLogin(cookies: Cookies): never {
  clearParticipantSession(cookies);
  redirect(303, PARTICIPANT_LOGIN_PATH);
}
