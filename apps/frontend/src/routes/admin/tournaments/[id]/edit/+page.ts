import {error} from '@sveltejs/kit';
import {createApiClient} from '$lib/api';
import type {PageLoad} from './$types';

// `GET /api/tournaments/:id` doesn't exist (only list + create + update), so
// the existing tournament is found client-side from the full list.
export const load: PageLoad = async ({params, fetch}) => {
  const api = createApiClient(fetch);
  const res = await api.api.tournaments.$get();
  const body = await res.json();
  if (!Array.isArray(body)) {
    throw error(500, body.error);
  }

  const tournament = body.find(t => t.id === params.id);
  if (!tournament) {
    throw error(404, '大会が見つかりません');
  }

  return {tournament};
};
