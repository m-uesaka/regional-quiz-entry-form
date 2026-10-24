import {redirect, type Cookies} from '@sveltejs/kit';

// The one-time token the password reset mails put in the link they send
// (`/password-reset?token=...`, `/staff/password-reset?token=...`).
//
// A mailed link can only carry it in the URL, but a URL is also what ends up
// in the browser's history, in a `Referer`, and on a screen someone else can
// read (#120). So the page's `load` moves the token into an httpOnly cookie
// scoped to that page and redirects to the bare URL, the way `/verify`
// already consumes its token before redirecting. From then on the token
// lives only in the cookie: never in the address bar, the page source or the
// serialized `load` data. It also survives a reload or a tab the browser
// restores -- the link is still good, so the page must keep working -- and it
// needs no JavaScript, so the forms keep working before hydration (#95).

/** The query parameter the mailed link carries the token in. */
export const TOKEN_PARAM = 'token';

/** Where one reset page keeps the token it was opened with. */
export interface ResetTokenCookie {
  name: string;
  /** The page's own path: the cookie is sent to that page and no other. */
  path: string;
  /** Matches the backend's token lifetime; a cookie left behind expires too. */
  maxAgeSeconds: number;
}

/** `TOKEN_TTL_MS` in `apps/backend/src/lib/password-reset.ts`. */
export const PARTICIPANT_RESET_TOKEN_COOKIE: ResetTokenCookie = {
  name: 'password_reset_token',
  path: '/password-reset',
  maxAgeSeconds: 60 * 60,
};

/** `TOKEN_TTL_MS` in `apps/backend/src/lib/staff-password-reset.ts`. */
export const STAFF_RESET_TOKEN_COOKIE: ResetTokenCookie = {
  name: 'staff_password_reset_token',
  path: '/staff/password-reset',
  maxAgeSeconds: 24 * 60 * 60,
};

/**
 * For a page's `load`: moves a token arriving in the URL into the cookie and
 * redirects to the same URL without it, or -- on any other visit -- reads
 * the token the cookie already holds.
 *
 * A present but empty `?token=` sets nothing (an empty token would render
 * the new-password form only for the schema to refuse it as if the password
 * were at fault), but it is still taken out of the URL.
 *
 * @param cookies `event.cookies`.
 * @param url `event.url`.
 * @param cookie Which page's cookie.
 * @return The token, or `null` when the cookie holds none. Never returns
 *     while the URL still carries a token: that path throws the redirect.
 */
export function takeResetToken(
  cookies: Cookies,
  url: URL,
  cookie: ResetTokenCookie,
): string | null {
  if (url.searchParams.has(TOKEN_PARAM)) {
    const token = url.searchParams.get(TOKEN_PARAM);
    if (token) {
      cookies.set(cookie.name, token, {
        path: cookie.path,
        httpOnly: true,
        // `lax`, not `strict`: the link is opened from a mail client, i.e. a
        // cross-site navigation, and the redirect that follows it has to
        // carry the cookie back.
        sameSite: 'lax',
        secure: url.protocol === 'https:',
        maxAge: cookie.maxAgeSeconds,
      });
    }
    const bare = new URL(url);
    bare.searchParams.delete(TOKEN_PARAM);
    redirect(303, `${bare.pathname}${bare.search}`);
  }
  return readResetToken(cookies, cookie);
}

/**
 * For a page's form action: the token the page was opened with.
 * @param cookies `event.cookies`.
 * @param cookie Which page's cookie.
 * @return The token, or `null` when there isn't a usable one.
 */
export function readResetToken(
  cookies: Cookies,
  cookie: ResetTokenCookie,
): string | null {
  return cookies.get(cookie.name) || null;
}

/**
 * Drops the token once it is spent or the API has refused it, so the page
 * goes back to what it shows without one.
 * @param cookies `event.cookies`.
 * @param url `event.url`; only its protocol is read.
 * @param cookie Which page's cookie.
 */
export function clearResetToken(
  cookies: Cookies,
  url: URL,
  cookie: ResetTokenCookie,
): void {
  cookies.delete(cookie.name, {
    path: cookie.path,
    secure: url.protocol === 'https:',
  });
}
