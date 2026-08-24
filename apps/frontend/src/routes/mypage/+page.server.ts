import {error} from '@sveltejs/kit';
import {createApiClient} from '$lib/api';
import type {PageServerLoad} from './$types';

export const load: PageServerLoad = async ({fetch}) => {
  const api = createApiClient(fetch);
  const res = await api.api.mypage.entries.$get();
  if (!res.ok) {
    if (res.status === 401) {
      throw error(401, 'ログインが必要です');
    }
    throw error(502, 'マイページ情報の取得に失敗しました');
  }

  return {entries: await res.json()};
};
