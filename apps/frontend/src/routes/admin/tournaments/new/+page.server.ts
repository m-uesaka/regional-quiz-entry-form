import {error, fail, redirect} from '@sveltejs/kit';
import {createApiClient, isUnauthorized, readErrorMessage} from '$lib/api';
import {
  parseTournamentFormValues,
  questionSetError,
  readTournamentFormValues,
} from '$lib/tournament-form';
import {redirectToStaffLogin} from '$lib/server/staff-session';
import type {TournamentFormValues} from '$lib/types/tournament-form';
import type {Actions, PageServerLoad} from './$types';

/**
 * What a refused create hands back; a successful one redirects to the new
 * tournament instead of returning at all.
 */
interface TournamentCreateActionResult {
  error: string;
  /** Echoed back so the refused form re-renders what was typed. */
  values: TournamentFormValues;
}

const INVALID_INPUT_MESSAGE = '入力内容を確認してください';

// Read and written server-side rather than from the browser: `/api/*` is
// only routed to the backend Worker for requests the frontend makes itself
// until Task 9-5 lands, so a client-side call would 404 in production.
export const load: PageServerLoad = async ({fetch, cookies, url}) => {
  const api = createApiClient(fetch);
  const [res, questionSetsRes] = await Promise.all([
    api.api.regions.$get(),
    api.api.tournaments['question-sets'].$get(),
  ]);
  if (!res.ok) {
    if (isUnauthorized(res)) {
      redirectToStaffLogin(cookies, url);
    }
    error(502, '地域の取得に失敗しました');
  }
  return {
    regions: await res.json(),
    // Only suggestions for 問題セット: the form works without them, so a
    // failed read leaves the list empty rather than the page unusable.
    questionSets: questionSetsRes.ok ? await questionSetsRes.json() : [],
  };
};

export const actions = {
  default: async ({request, fetch, cookies, url}) => {
    const values = readTournamentFormValues(await request.formData());
    const input = parseTournamentFormValues(values);
    if (!input) {
      return createFailure(
        400,
        values,
        questionSetError(values) ?? INVALID_INPUT_MESSAGE,
      );
    }

    const res = await createApiClient(fetch).api.tournaments.$post({
      json: input,
    });
    if (!res.ok) {
      if (isUnauthorized(res)) {
        redirectToStaffLogin(cookies, url);
      }
      // A constraint the database refused -- 400 for a region that doesn't
      // exist, 409 for a second tournament of the same type in it (#199) --
      // which the API words in Japanese itself, so it is shown rather than
      // replaced.
      if (res.status === 400 || res.status === 409) {
        return createFailure(
          res.status,
          values,
          await readErrorMessage(res, INVALID_INPUT_MESSAGE),
        );
      }
      return createFailure(502, values, '大会の作成に失敗しました');
    }

    const created = await res.json();
    if (!('id' in created)) {
      return createFailure(502, values, '大会の作成に失敗しました');
    }
    // Redirected rather than left on the create form: re-submitting it would
    // insert a second tournament, and everything else about a tournament —
    // its regulations, its sheet import — is managed from the edit screen.
    redirect(303, `/admin/tournaments/${created.id}/edit`);
  },
} satisfies Actions;

/**
 * Refuses a create, re-rendering what was typed.
 * @param status The status to answer with.
 * @param values What was submitted.
 * @param message The message to show above the form.
 */
function createFailure(
  status: number,
  values: TournamentFormValues,
  message: string,
) {
  return fail(status, {
    error: message,
    values,
  } satisfies TournamentCreateActionResult);
}
