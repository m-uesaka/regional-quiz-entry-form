import {error, type Cookies} from '@sveltejs/kit';
import {
  TournamentTypeSchema,
  type Tournament,
  type TournamentType,
} from '@regional-quiz/shared';
import {
  createApiClient,
  isNotFound,
  isUnauthorized,
  resolveApiErrorMessage,
  type ApiErrorMessages,
} from '$lib/api';
import {redirectToStaffLogin} from '$lib/server/staff-session';

/** What a route naming a tournament by its slugs hands the helpers below. */
export interface TournamentRouteEvent {
  params: {regionSlug: string; tournamentSlug: string};
  fetch: typeof fetch;
  /** The cookies a refused staff session is cleared from. */
  cookies: Cookies;
  /** The URL a refused staff session is sent back to after logging in. */
  url: URL;
}

/** How `fetchTournamentBySlug` words what differs between its callers. */
export interface TournamentBySlugOptions {
  /**
   * What a 403 is shown as, picked by the refusal's `error` code the way
   * `resolveApiErrorMessage` does. A page with one wording for every 403
   * passes only `fallback`; the entry page tells a paused tournament
   * (`entries_paused`) from a closed entry period with `byCode`.
   */
  forbiddenMessages: ApiErrorMessages;
}

/**
 * Narrows a route's `tournamentSlug` to a tournament type. The RPC client's
 * param type for it is the literal union (inferred from the backend's
 * zValidator), not a bare `string`, so a raw route param needs narrowing
 * before it typechecks. A slug naming no type is reported as "not found",
 * not a 500.
 * @param tournamentSlug The route param.
 */
export function parseTournamentSlug(tournamentSlug: string): TournamentType {
  const parsed = TournamentTypeSchema.safeParse(tournamentSlug);
  if (!parsed.success) {
    throw error(404, '大会が見つかりません');
  }
  return parsed.data;
}

/**
 * Reads the tournament a route names by its region and tournament slugs,
 * from `GET /api/tournaments/:regionSlug/:tournamentSlug`, turning a refusal
 * into the page's error: 404 for no such tournament, the staff login screen
 * for a dead staff session, 403 (worded by the caller) when the backend
 * withholds the tournament -- outside the entry period, or while the
 * tournament is paused (`entries_paused`) -- and 502 for anything else.
 * @param event The route's `params` and `fetch`, plus the `cookies` and
 *     `url` a refused staff session is cleared and redirected with.
 * @param options What the 403 is shown as.
 */
export async function fetchTournamentBySlug(
  {params, fetch, cookies, url}: TournamentRouteEvent,
  {forbiddenMessages}: TournamentBySlugOptions,
): Promise<Tournament> {
  const tournamentSlug = parseTournamentSlug(params.tournamentSlug);

  const api = createApiClient(fetch);
  const res = await api.api.tournaments[':regionSlug'][':tournamentSlug'].$get({
    param: {regionSlug: params.regionSlug, tournamentSlug},
  });
  if (!res.ok) {
    if (isNotFound(res)) {
      throw error(404, '大会が見つかりません');
    }
    // A 401 means the request carried a staff cookie the gate refused: it
    // expired between `hooks.server.ts` parsing it and this request reaching
    // the backend, or its sessions were revoked. The gate tells that apart
    // from a caller who never had a session, so the cookie is dropped and
    // its holder sent to log in again, rather than stranded on the 403
    // below while the dead cookie stays put.
    if (isUnauthorized(res)) {
      redirectToStaffLogin(cookies, url);
    }
    // Outside the entry period, and while the tournament is paused, the
    // backend hands the tournament only to the staff who cover it
    // (`middleware/entry-period.ts`), and answers before the tournament is
    // readable at all -- so this is what a visitor with no staff session, or
    // one covering another region, actually gets. The refusal's `error` code
    // tells the two apart, for a caller whose wording does.
    if (res.status === 403) {
      throw error(403, await resolveApiErrorMessage(res, forbiddenMessages));
    }
    throw error(502, '大会情報の取得に失敗しました');
  }
  return res.json();
}
