import {error, fail, redirect} from '@sveltejs/kit';
import {MypageEntrySchema} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import type {Actions, PageServerLoad} from './$types';

export const load: PageServerLoad = async ({fetch}) => {
  const api = createApiClient(fetch);
  const res = await api.api.mypage.entries.$get();
  if (!res.ok) {
    if (res.status === 401) {
      // No session (or an expired one): the participant is sent to the login
      // form rather than shown an error they can do nothing about.
      throw redirect(303, '/mypage/login');
    }
    throw error(502, 'マイページ情報の取得に失敗しました');
  }

  return {entries: await res.json()};
};

export const actions = {
  cancel: async ({request, fetch}) => {
    const formData = await request.formData();
    // The id travels in the body (one form per listed entry), so it's
    // validated against the same schema the API answers with rather than
    // passed through as-is.
    const entryId = MypageEntrySchema.shape.id.safeParse(
      formData.get('entryId'),
    );
    if (!entryId.success) {
      return fail(400, {
        error: 'キャンセルするエントリーを特定できませんでした',
      });
    }

    const api = createApiClient(fetch);
    const res = await api.api.mypage.entries[':entryId'].$delete({
      param: {entryId: entryId.data},
    });
    if (!res.ok) {
      if (res.status === 401) {
        // The session can expire between the page load and this submission.
        throw redirect(303, '/mypage/login');
      }
      if (res.status === 404) {
        return fail(404, {error: 'エントリーが見つかりません'});
      }
      return fail(502, {error: 'エントリーのキャンセルに失敗しました'});
    }

    // Nothing is returned on success: `load` re-runs after the action, so
    // the entry re-renders as cancelled without a separate message.
    return;
  },
} satisfies Actions;
