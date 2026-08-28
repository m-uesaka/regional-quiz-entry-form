import {error, fail, redirect} from '@sveltejs/kit';
import {MypageEntrySchema} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import {
  clearParticipantSession,
  PARTICIPANT_LOGIN_PATH,
  redirectToParticipantLogin,
} from '$lib/server/participant-session';
import {forwardSetCookies} from '$lib/server/backend-cookies';
import type {Actions, PageServerLoad} from './$types';

export const load: PageServerLoad = async ({cookies, fetch}) => {
  const api = createApiClient(fetch);
  const res = await api.api.mypage.entries.$get();
  if (!res.ok) {
    if (res.status === 401) {
      // No session (or one the API no longer honours): the participant is
      // sent to the login form rather than shown an error they can do
      // nothing about.
      redirectToParticipantLogin(cookies);
    }
    throw error(502, 'マイページ情報の取得に失敗しました');
  }

  return {entries: await res.json()};
};

export const actions = {
  logout: async ({cookies, fetch, url}) => {
    const api = createApiClient(fetch);
    const res = await api.api.auth.participant.logout.$post();
    // The API answers with the cookie deletion, and `/api/*` goes to the
    // backend Worker's own origin, so the `Set-Cookie` is re-issued from
    // this origin by hand to reach the browser at all.
    forwardSetCookies(res, cookies, url);
    // The endpoint cannot fail on the backend's own terms -- it only writes
    // a header -- but the request to it can (the Worker being down, say),
    // and a logout that leaves the session in place is the one outcome not
    // worth reporting back. Dropping the cookie here ends the session on
    // this side regardless; the JWT stays signed either way (see
    // `apps/backend/src/routes/participant-auth.ts`).
    if (!res.ok) {
      clearParticipantSession(cookies);
    }
    redirect(303, PARTICIPANT_LOGIN_PATH);
  },

  cancel: async ({cookies, request, fetch}) => {
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
        // The session can die between the page load and this submission.
        redirectToParticipantLogin(cookies);
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
