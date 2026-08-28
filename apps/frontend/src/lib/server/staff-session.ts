import {verify} from 'hono/jwt';
import type {Cookies} from '@sveltejs/kit';
import {StaffClaimsSchema, type StaffClaims} from '@regional-quiz/shared';

/**
 * Matches `STAFF_SESSION_COOKIE` in
 * `apps/backend/src/middleware/staff-auth.ts`.
 */
export const STAFF_SESSION_COOKIE = 'staff_session';

/**
 * Drops the staff session cookie the browser is still holding.
 *
 * The `path` matches the one the cookie is issued under, since a delete only
 * matches a cookie of the same name *and* path, and `secure` is decided from
 * the frontend's own protocol -- both for the reasons
 * `clearParticipantSession()` spells out in `./participant-session.ts`.
 *
 * @param cookies `event.cookies`.
 * @param url `event.url`, i.e. the origin the deletion is issued from. Only
 *     its protocol is read.
 */
export function clearStaffSession(cookies: Cookies, url: URL): void {
  cookies.delete(STAFF_SESSION_COOKIE, {
    path: '/',
    secure: url.protocol === 'https:',
  });
}

/**
 * Verifies and parses the `staff_session` JWT issued by the backend on
 * staff login. Mirrors `apps/backend/src/middleware/staff-auth.ts`'s
 * private `readStaffClaims()` so the frontend recognizes the same session
 * cookie the backend does.
 *
 * @param token The raw `staff_session` cookie value, if present.
 * @param secret The `SESSION_SECRET` used to sign the token. May be
 *     `undefined` outside a real Cloudflare context (e.g. local `vite dev`
 *     or tests), in which case this always resolves to `null`.
 * @return The parsed claims, or `null` if the token is missing, invalid,
 *     expired, or doesn't match the expected shape.
 */
export async function readStaffClaims(
  token: string | undefined,
  secret: string | undefined,
): Promise<StaffClaims | null> {
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
    return StaffClaimsSchema.parse(payload);
  } catch {
    // Covers both an invalid/expired signature (thrown by `verify`) and
    // claims that don't match the expected shape (thrown by `.parse`).
    return null;
  }
}
