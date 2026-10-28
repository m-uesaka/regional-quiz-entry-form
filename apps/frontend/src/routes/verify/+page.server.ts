import {fail, redirect, type Cookies} from '@sveltejs/kit';
import {createApiClient} from '$lib/api';
import {dropCachedEntryList} from '$lib/server/entry-list-cache';
import {
  clearResetToken,
  ENTRY_VERIFICATION_TOKEN_COOKIE,
  readResetToken,
  takeResetToken,
} from '$lib/server/reset-token';
import type {Actions, PageServerLoad} from './$types';

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

/**
 * What the page shows: the confirm button while it holds a token that
 * hasn't been tried yet (`ready`), or the outcome of trying it.
 */
export type VerifyPageStatus = VerifyStatus | 'ready';

const VERIFY_STATUSES: readonly VerifyStatus[] = [
  'confirmed',
  'waitlisted',
  'invalid',
];

/**
 * Where the action leaves the outcome of the last button press, so the bare
 * `/verify` still shows it. That URL is the confirm page's own, and it stays
 * in the history below the outcome: pressing Back to it after the token was
 * spent would otherwise call a just-confirmed entry's link invalid.
 */
const OUTCOME_COOKIE = 'entry_verification_outcome';

/**
 * Long enough for Back and a restored tab, short enough that a later,
 * unrelated visit to `/verify` falls back to "invalid" rather than to an
 * old outcome.
 */
const OUTCOME_MAX_AGE_SECONDS = 60 * 60;

/**
 * Opening the mailed link confirms nothing (#190). Mail gateways (Outlook
 * Safe Links and the like) and chat link previews fetch a link before its
 * recipient clicks it, so a GET that spent the token would confirm entries
 * nobody chose to confirm -- including one a stranger made under the
 * recipient's address. `load` only moves the token out of the URL into a
 * cookie (`$lib/server/reset-token.ts`), and the button the page then shows
 * submits the action below, which is what spends it.
 */
export const load: PageServerLoad = ({
  cookies,
  url,
}): {status: VerifyPageStatus} => {
  // Throws the redirect to the bare `/verify` when the URL still carries
  // the token.
  const token = takeResetToken(cookies, url, ENTRY_VERIFICATION_TOKEN_COOKIE);

  // A link that lost its query string -- or a hand-edited `status` -- can't
  // be told apart from a dead token by the participant, so both land on the
  // same "enter again" guidance instead of on an error page.
  const status = url.searchParams.get('status');
  if (status !== null) {
    return {status: isVerifyStatus(status) ? status : 'invalid'};
  }
  if (token !== null) {
    return {status: 'ready'};
  }
  const outcome = cookies.get(OUTCOME_COOKIE);
  return {status: outcome && isVerifyStatus(outcome) ? outcome : 'invalid'};
};

export const actions = {
  /**
   * Confirms the entry the token was issued for, consuming the token. This
   * is the moment the entry first shows up on its tournament's public list,
   * so the cached copy of that list is dropped (#125).
   */
  default: async ({cookies, fetch, platform, url}) => {
    const token = readResetToken(cookies, ENTRY_VERIFICATION_TOKEN_COOKIE);
    if (token === null) {
      // The cookie expired with the link, or the button was submitted from a
      // page left open after the token was spent.
      redirectToOutcome(cookies, url, 'invalid');
    }

    const api = createApiClient(fetch);
    const res = await api.api.entries.verify.$post({json: {token}});
    if (!res.ok) {
      // The backend answers 400 only for a token the database actually
      // refused, and 500 for anything else (a Supabase outage, say), so a
      // 400 is an outcome to render while everything else leaves the token
      // in place for another try -- telling a participant to enter again
      // after a transient failure would strand an entry that is still
      // `pending_verification`.
      if (res.status === 400) {
        clearResetToken(cookies, url, ENTRY_VERIFICATION_TOKEN_COOKIE);
        redirectToOutcome(cookies, url, 'invalid');
      }
      return fail(502, {
        error:
          'エントリーの確定に失敗しました。時間をおいて、もう一度お試しください',
      });
    }

    clearResetToken(cookies, url, ENTRY_VERIFICATION_TOKEN_COOKIE);
    const {status, tournament} = await res.json();
    // `null` when the backend could not say which tournament it was; the
    // list then catches up when its cached copy expires.
    if (tournament) {
      await dropCachedEntryList(platform, url.origin, tournament);
    }
    redirectToOutcome(cookies, url, status);
  },
} satisfies Actions;

/**
 * Shows `status` as the outcome of the button press. It is carried into the
 * URL, so a reload shows it again rather than re-submitting a spent token,
 * and into `OUTCOME_COOKIE`, so Back to the bare `/verify` does too.
 */
function redirectToOutcome(
  cookies: Cookies,
  url: URL,
  status: VerifyStatus,
): never {
  cookies.set(OUTCOME_COOKIE, status, {
    path: ENTRY_VERIFICATION_TOKEN_COOKIE.path,
    httpOnly: true,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    maxAge: OUTCOME_MAX_AGE_SECONDS,
  });
  redirect(303, `/verify?status=${status}`);
}

function isVerifyStatus(value: string): value is VerifyStatus {
  return VERIFY_STATUSES.includes(value as VerifyStatus);
}
