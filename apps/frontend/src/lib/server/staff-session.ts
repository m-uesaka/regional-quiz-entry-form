import {verify} from 'hono/jwt';
import {redirect, type Cookies} from '@sveltejs/kit';
import {StaffClaimsSchema, type StaffClaims} from '@regional-quiz/shared';
import {staffLoginPath} from './staff-login';

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
 * Sends a staff member whose session the API has just refused to the login
 * form, dropping the dead cookie on the way.
 *
 * `readStaffClaims` below can only check the signature and the expiry, but
 * the backend also refuses a session whose account's sessions have been
 * revoked since it was issued, and one whose account is gone (see
 * `isSessionCurrent()` in `apps/backend/src/middleware/staff-auth.ts`). Such
 * a cookie still reads as a session here, so left in place it would keep the
 * staff layout offering a logout to someone the API has already logged out,
 * and let every `/admin` screen past its guard only to be refused again.
 * Same idea as `redirectToParticipantLogin()` in `./participant-session.ts`.
 *
 * @param cookies `event.cookies`.
 * @param url `event.url`: the page to come back to after logging in, and the
 *     origin the deletion is issued from.
 */
export function redirectToStaffLogin(cookies: Cookies, url: URL): never {
  clearStaffSession(cookies, url);
  redirect(303, staffLoginPath(url));
}

/**
 * Verifies and parses the `staff_session` JWT issued by the backend on
 * staff login. Mirrors `apps/backend/src/middleware/staff-auth.ts`'s
 * `readStaffClaims()` so the frontend recognizes the same session cookie
 * the backend does. Like that one, it can't tell a revoked session from a
 * live one -- only the API can, by reading `staff_accounts` -- so a page has
 * to treat the API's 401 as the final word (`redirectToStaffLogin()`).
 *
 * A cookie issued before the `sessionsValidFrom` claim existed fails the
 * schema and so reads as logged out, which is also how the API treats it.
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
