import {error} from '@sveltejs/kit';
import {createApiClient} from '$lib/api';
import type {PageServerLoad} from './$types';

export const load: PageServerLoad = async ({fetch, locals}) => {
  if (!locals.staff) {
    throw error(401, 'ログインが必要です');
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
    if (res.status === 403) {
      throw error(403, '全地域ダッシュボードは統括スタッフ専用です');
    }
    throw error(502, 'エントリー状況の取得に失敗しました');
  }

  return {summaries: await res.json()};
};
