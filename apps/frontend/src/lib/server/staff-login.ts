import type {StaffLoginResponse} from '@regional-quiz/shared';

/** The staff login screen. */
export const STAFF_LOGIN_PATH = '/staff/login';

/**
 * The login screen to send an unauthenticated staff request to, carrying the
 * page it was aimed at so the login can hand it back afterwards.
 *
 * @param url The URL of the page that turned out to need a session.
 * @return The path to redirect to.
 */
export function staffLoginPath(url: URL): string {
  const requested = `${url.pathname}${url.search}`;
  return `${STAFF_LOGIN_PATH}?redirectTo=${encodeURIComponent(requested)}`;
}

/**
 * The screen a staff member lands on right after logging in.
 *
 * @param session The backend's answer to the login request.
 * @param redirectTo The `redirectTo` query parameter of the login screen,
 *     i.e. the page they were originally aiming at, if any.
 * @return The path to redirect to, or `null` when the account has no screen
 *     to land on — a `regional` account with no tournament assigned, which
 *     the database allows but a correctly provisioned account never is.
 */
export function staffLandingPath(
  session: StaffLoginResponse,
  redirectTo: string | null,
): string | null {
  const requested = safeStaffPath(redirectTo);
  if (requested && isReachableBy(session, requested)) return requested;
  return staffHomePath(session);
}

/**
 * The screen a staff member lands on when there is no page to hand back.
 *
 * @param session The backend's answer to the login request.
 * @return The path, or `null` when the account has no screen to land on.
 */
function staffHomePath(session: StaffLoginResponse): string | null {
  // General staff see every region, so the cross-region dashboard is their
  // home; regional staff would only get a 403 there and are sent to the one
  // tournament they are scoped to instead.
  if (session.role === 'general') return '/staff/dashboard';
  if (session.regionSlug && session.tournamentType) {
    return `/staff/${session.regionSlug}/${session.tournamentType}/entries`;
  }
  return null;
}

/**
 * Whether this account would actually be let into the requested page.
 *
 * Handing back a page the account is scoped out of would land the login on a
 * 403 instead of anywhere useful: a shared `/staff/dashboard` link that
 * bounced a logged-out `regional` account through here comes back as
 * `redirectTo`, and the dashboard is `general`-only. Regional staff are
 * therefore only handed back pages under their own tournament, and sent to
 * their home screen for anything else.
 *
 * @param session The backend's answer to the login request.
 * @param target A path that already passed `safeStaffPath`.
 * @return Whether to honour it.
 */
function isReachableBy(session: StaffLoginResponse, target: string): boolean {
  if (session.role === 'general') return true;
  if (!session.regionSlug || !session.tournamentType) return false;

  const scope = `/staff/${session.regionSlug}/${session.tournamentType}`;
  if (!target.startsWith(scope)) return false;
  // Without this, `/staff/tokyo/saikyoi-2` would pass as being under
  // `/staff/tokyo/saikyoi`.
  const next = target.charAt(scope.length);
  return next === '' || next === '/' || next === '?';
}

/**
 * Narrows a `redirectTo` value to a path this screen is willing to send a
 * browser to.
 *
 * The value comes from the query string, so anything else would be an open
 * redirect: a leading `//` or `/\` is read as a protocol-relative URL and
 * would leave the site entirely. Requiring the `/staff/` prefix rules both
 * out, and excluding the login screen itself keeps a stale `redirectTo` from
 * bouncing straight back here.
 *
 * @param target The raw `redirectTo` value.
 * @return The path, or `null` when it isn't one to honour.
 */
function safeStaffPath(target: string | null): string | null {
  if (!target || !target.startsWith('/staff/')) return null;
  if (
    target === STAFF_LOGIN_PATH ||
    target.startsWith(`${STAFF_LOGIN_PATH}?`)
  ) {
    return null;
  }
  return target;
}
