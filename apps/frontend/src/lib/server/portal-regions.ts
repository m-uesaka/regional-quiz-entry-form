import {error} from '@sveltejs/kit';
import {createApiClient} from '$lib/api';
import {groupPortalTournaments, type PortalRegionView} from '$lib/portal';

/**
 * Reads every tournament from `GET /api/portal/tournaments` and groups them
 * by region, for the pages that list them (the portal and the entry-list
 * index). A failed read is the page's error: neither has anything else to
 * show without it.
 *
 * The statuses are worked out here rather than in the page so that the
 * server-rendered HTML and the hydrated page agree: a page computing them
 * from the browser's clock could flip a form between 受付開始前 and 受付中
 * on hydration.
 * @param fetchImpl The `fetch` SvelteKit hands the `load` function.
 */
export async function loadPortalRegions(
  fetchImpl: typeof fetch,
): Promise<PortalRegionView[]> {
  const api = createApiClient(fetchImpl);
  const res = await api.api.portal.tournaments.$get();
  if (!res.ok) {
    console.error(`GET /api/portal/tournaments answered ${res.status}`);
    throw error(502, '大会一覧の取得に失敗しました');
  }
  return groupPortalTournaments(await res.json(), new Date());
}
