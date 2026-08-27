import {error} from '@sveltejs/kit';
import {createApiClient} from '$lib/api';
import type {PageServerLoad} from './$types';

/**
 * What the confirmation attempt produced, as the page renders it.
 *
 * `invalid` covers every 400 the backend answers with -- an unknown,
 * expired, or already-used token, and a token whose entry is no longer
 * awaiting verification -- because the endpoint deliberately doesn't tell
 * those apart to an unauthenticated caller, and the guidance ("enter again")
 * is the same for all of them.
 */
export type VerifyStatus = 'confirmed' | 'waitlisted' | 'invalid';

export const load: PageServerLoad = async ({
  url,
  fetch,
}): Promise<{status: VerifyStatus}> => {
  const token = url.searchParams.get('token');
  // A link that lost its query string can't be told apart from a bad token
  // by the participant, so it lands on the same "enter again" guidance
  // instead of on an error page.
  if (!token) {
    return {status: 'invalid'};
  }

  const api = createApiClient(fetch);
  const res = await api.api.entries.verify.$get({query: {token}});
  // The confirmation itself happens here: the entry is only finalised once
  // the participant opens the link, so this `load` is what performs it and a
  // 400 is an expected outcome to render, not a failure to report.
  if (!res.ok) {
    if (res.status === 400) {
      return {status: 'invalid'};
    }
    throw error(502, 'エントリーの確定に失敗しました');
  }

  return {status: (await res.json()).status};
};
