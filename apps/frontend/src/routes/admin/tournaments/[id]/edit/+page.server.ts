import {error, redirect} from '@sveltejs/kit';
import {createApiClient, isUnauthorized} from '$lib/api';
import {staffLoginPath} from '$lib/server/staff-login';
import type {PageServerLoad} from './$types';

// Read on the server rather than in the browser (this was a `+page.ts`):
// `/api/*` is only routed to the backend Worker for requests the frontend
// makes itself until Task 9-5 lands, so the region list a client-side load
// needs would 404 in production.
export const load: PageServerLoad = async ({params, fetch, url}) => {
  const api = createApiClient(fetch);
  const [tournamentsRes, regionsRes] = await Promise.all([
    api.api.tournaments.$get(),
    api.api.regions.$get(),
  ]);
  if (!tournamentsRes.ok || !regionsRes.ok) {
    if (isUnauthorized(tournamentsRes) || isUnauthorized(regionsRes)) {
      redirect(303, staffLoginPath(url));
    }
    error(502, '大会情報の取得に失敗しました');
  }

  // `GET /api/tournaments/:id` doesn't exist (only list + create + update),
  // so the tournament being edited is picked out of the full list.
  const tournament = (await tournamentsRes.json()).find(
    t => t.id === params.id,
  );
  if (!tournament) {
    error(404, '大会が見つかりません');
  }

  return {tournament, regions: await regionsRes.json()};
};
