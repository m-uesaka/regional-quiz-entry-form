import {error} from '@sveltejs/kit';
import {createApiClient} from '$lib/api';
import type {PageServerLoad} from './$types';

export const load: PageServerLoad = async ({params, fetch, locals}) => {
  if (!locals.staff) {
    throw error(401, 'ログインが必要です');
  }

  const api = createApiClient(fetch);
  const res = await api.api.staff.entries[':entryId'].$get({
    param: {entryId: params.entryId},
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw error(404, 'エントリーが見つかりません');
    }
    if (res.status === 403) {
      throw error(403, 'このエントリーを閲覧する権限がありません');
    }
    throw error(502, 'エントリー情報の取得に失敗しました');
  }

  return {entry: await res.json()};
};
