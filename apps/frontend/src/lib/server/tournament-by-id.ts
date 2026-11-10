import {error, type Cookies} from '@sveltejs/kit';
import {TournamentSchema, type TournamentDetail} from '@regional-quiz/shared';
import {createApiClient, isNotFound, isUnauthorized} from '$lib/api';
import {redirectToStaffLogin} from '$lib/server/staff-session';

/** What a route naming a tournament by its id hands the helpers below. */
export interface TournamentByIdRouteEvent {
  params: {id: string};
  fetch: typeof fetch;
  /** The cookies a refused staff session is cleared from. */
  cookies: Cookies;
  /** The URL a refused staff session is sent back to after logging in. */
  url: URL;
}

/** How `fetchTournamentById` words what differs between its callers. */
export interface TournamentByIdOptions {
  /**
   * What a failure other than "no such tournament" or a dead staff session
   * is shown as, with status 502. Each page names what it failed to show
   * (the tournament itself, its regulations, ...).
   */
  failureMessage: string;
}

/**
 * Checks that a route's `[id]` can name a tournament at all. An id that
 * isn't a UUID names none, and is answered here as "not found" rather than
 * sent on to come back as the API's 400 -- which would then be
 * indistinguishable from any other request the API refused.
 *
 * A page that reads anything alongside the tournament calls this before
 * sending any of it, so a malformed id asks the API nothing.
 * @param id The route param.
 * @return The id, unchanged.
 */
export function parseTournamentId(id: string): string {
  if (!TournamentSchema.shape.id.safeParse(id).success) {
    error(404, '大会が見つかりません');
  }
  return id;
}

/**
 * Reads the tournament a route names by its id, from
 * `GET /api/tournaments/:id`, turning a refusal into the page's error: the
 * staff login screen for a dead staff session, 404 for no such tournament,
 * and 502 (worded by the caller) for anything else -- a 403 included, since
 * every page under `/admin/tournaments/[id]` is for general staff, whom the
 * read never refuses.
 *
 * A page reading something else alongside decides itself whose refusal wins
 * (an expired session the other read reports, a 404 it answers): it starts
 * this read, weighs the other response first, and awaits this one where its
 * refusal ranks.
 * @param event The route's `params` and `fetch`, plus the `cookies` and
 *     `url` a refused staff session is cleared and redirected with.
 * @param options What a failed read is shown as.
 */
export async function fetchTournamentById(
  {params, fetch, cookies, url}: TournamentByIdRouteEvent,
  {failureMessage}: TournamentByIdOptions,
): Promise<TournamentDetail> {
  const id = parseTournamentId(params.id);

  const res = await createApiClient(fetch).api.tournaments[':id'].$get({
    param: {id},
  });
  if (!res.ok) {
    // The layout guard cannot rule this out: the JWT may expire between
    // `hooks.server.ts` parsing it and this request reaching the backend,
    // or its sessions may have been revoked.
    if (isUnauthorized(res)) {
      redirectToStaffLogin(cookies, url);
    }
    if (isNotFound(res)) {
      error(404, '大会が見つかりません');
    }
    error(502, failureMessage);
  }
  return res.json();
}
