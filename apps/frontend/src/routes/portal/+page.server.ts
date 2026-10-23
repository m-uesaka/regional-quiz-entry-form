import {error} from '@sveltejs/kit';
import {createApiClient} from '$lib/api';
import {groupPortalTournaments} from '$lib/portal';
import type {PageServerLoad} from './$types';

export const load: PageServerLoad = async ({fetch}) => {
  const api = createApiClient(fetch);
  const res = await api.api.portal.tournaments.$get();
  if (!res.ok) {
    throw error(502, '大会一覧の取得に失敗しました');
  }

  // The statuses are worked out here rather than in the page so that the
  // server-rendered HTML and the hydrated page agree: a page computing them
  // from the browser's clock could flip a form between 受付開始前 and 受付中
  // on hydration.
  return {regions: groupPortalTournaments(await res.json(), new Date())};
};
