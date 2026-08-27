import {error, redirect} from '@sveltejs/kit';
import {createApiClient} from '$lib/api';
import {staffLoginPath} from '$lib/server/staff-login';
import type {PageServerLoad} from './$types';

export const load: PageServerLoad = async ({fetch, locals, url}) => {
  if (!locals.staff) {
    redirect(303, staffLoginPath(url));
  }
  // The backend answers regional staff with a 403 anyway; checking the
  // claims already parsed by `hooks.server.ts` turns that into the same
  // message without a round trip.
  if (locals.staff.role !== 'general') {
    throw error(403, '全地域ダッシュボードは統括スタッフ専用です');
  }

  const api = createApiClient(fetch);
  const res = await api.api.staff.dashboard.$get();
  if (!res.ok) {
    // The claims check above cannot rule this out: the JWT may expire between
    // `hooks.server.ts` parsing it and this request reaching the backend.
    if (res.status === 401) {
      redirect(303, staffLoginPath(url));
    }
    if (res.status === 403) {
      throw error(403, '全地域ダッシュボードは統括スタッフ専用です');
    }
    throw error(502, 'エントリー状況の取得に失敗しました');
  }

  return {summaries: await res.json()};
};
