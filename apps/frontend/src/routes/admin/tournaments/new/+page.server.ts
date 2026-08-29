import {error, fail, redirect} from '@sveltejs/kit';
import {createApiClient, isUnauthorized} from '$lib/api';
import {
  parseTournamentFormValues,
  readTournamentFormValues,
} from '$lib/tournament-form';
import {staffLoginPath} from '$lib/server/staff-login';
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
export const load: PageServerLoad = async ({fetch, url}) => {
  const res = await createApiClient(fetch).api.regions.$get();
  if (!res.ok) {
    if (isUnauthorized(res)) {
      redirect(303, staffLoginPath(url));
    }
    error(502, '地域の取得に失敗しました');
  }
  return {regions: await res.json()};
};

export const actions = {
  default: async ({request, fetch, url}) => {
    const values = readTournamentFormValues(await request.formData());
    const input = parseTournamentFormValues(values);
    if (!input) {
      return createFailure(400, values, INVALID_INPUT_MESSAGE);
    }

    const res = await createApiClient(fetch).api.tournaments.$post({
      json: input,
    });
    if (!res.ok) {
      if (isUnauthorized(res)) {
        redirect(303, staffLoginPath(url));
      }
      // 400 is what the database refused — a region that no longer exists,
      // say — and the API passes that message through, so it is shown
      // rather than replaced.
      if (res.status === 400) {
        return createFailure(
          400,
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

/**
 * Reads the `{error: string}` body the backend answers a refusal with.
 * @param res The failed API response.
 * @param fallback What to say when the body carries no message.
 */
async function readErrorMessage(
  res: {json(): Promise<unknown>},
  fallback: string,
): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
    ) {
      return body.error;
    }
  } catch {
    // A non-JSON body (a proxy error page, say) leaves the fallback to
    // speak for itself.
  }
  return fallback;
}
