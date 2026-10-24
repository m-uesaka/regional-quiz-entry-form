import {error, redirect} from '@sveltejs/kit';
import {createApiClient} from '$lib/api';
import {dropCachedEntryList} from '$lib/server/entry-list-cache';
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

const VERIFY_STATUSES: readonly VerifyStatus[] = [
  'confirmed',
  'waitlisted',
  'invalid',
];

export const load: PageServerLoad = async ({
  url,
  fetch,
  platform,
}): Promise<{status: VerifyStatus}> => {
  const token = url.searchParams.get('token');
  if (token) {
    const status = await confirmEntry(fetch, token, platform, url.origin);
    // Confirming consumes the token, so the outcome is carried into a
    // token-less URL before anything is rendered. A reload or a Back
    // navigation re-runs this `load` (SvelteKit re-fetches the server data
    // on popstate), and re-sending a spent token would answer 400 and tell
    // a participant who was just confirmed that their link is invalid.
    throw redirect(303, `/verify?status=${status}`);
  }

  // A link that lost its query string -- or a hand-edited `status` -- can't
  // be told apart from a dead token by the participant, so both land on the
  // same "enter again" guidance instead of on an error page.
  const status = url.searchParams.get('status');
  return {status: isVerifyStatus(status) ? status : 'invalid'};
};

/**
 * Confirms the entry the token was issued for, consuming the token. This is
 * the moment the entry first shows up on its tournament's public list, so
 * the cached copy of that list is dropped (#125).
 */
async function confirmEntry(
  fetchImpl: typeof fetch,
  token: string,
  platform: App.Platform | undefined,
  origin: string,
): Promise<VerifyStatus> {
  const api = createApiClient(fetchImpl);
  const res = await api.api.entries.verify.$get({query: {token}});
  if (!res.ok) {
    // The backend answers 400 only for a token the database actually
    // refused, and 500 for anything else (a Supabase outage, say), so a 400
    // is an outcome to render while everything else is a fault to report --
    // telling a participant to enter again after a transient failure would
    // strand an entry that is still `pending_verification`.
    if (res.status === 400) {
      return 'invalid';
    }
    throw error(502, 'エントリーの確定に失敗しました');
  }

  const {status, tournament} = await res.json();
  // `null` when the backend could not say which tournament it was; the
  // list then catches up when its cached copy expires.
  if (tournament) {
    await dropCachedEntryList(platform, origin, tournament);
  }
  return status;
}

function isVerifyStatus(value: string | null): value is VerifyStatus {
  return VERIFY_STATUSES.includes(value as VerifyStatus);
}
