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
 * What the update action hands back. The successful branch carries the same
 * properties as the refusals so the page can read `form.error` without
 * narrowing first.
 */
interface TournamentUpdateActionResult {
  saved: boolean;
  error: string | null;
  /**
   * The submitted controls, echoed back so a refused save re-renders what
   * was typed. Null after a successful save, where `load` has just re-read
   * the stored tournament.
   */
  values: TournamentFormValues | null;
}

const INVALID_INPUT_MESSAGE = '入力内容を確認してください';

// Read and written on the server rather than in the browser (this was a
// `+page.ts` calling the API from the client): `/api/*` is only routed to
// the backend Worker for requests the frontend makes itself until Task 9-5
// lands, so a client-side call would 404 in production.
export const load: PageServerLoad = async ({params, fetch, url}) => {
  const api = createApiClient(fetch);
  const [tournamentsRes, regionsRes] = await Promise.all([
    api.api.tournaments.$get(),
    api.api.regions.$get(),
  ]);
  if (!tournamentsRes.ok || !regionsRes.ok) {
    if (isUnauthorized(tournamentsRes) || isUnauthorized(regionsRes)) {
      redirect(303, staffLoginPath(url));
    }
    error(502, '大会情報の取得に失敗しました');
  }

  // `GET /api/tournaments/:id` doesn't exist (only list + create + update),
  // so the tournament being edited is picked out of the full list.
  const tournament = (await tournamentsRes.json()).find(
    t => t.id === params.id,
  );
  if (!tournament) {
    error(404, '大会が見つかりません');
  }

  return {tournament, regions: await regionsRes.json()};
};

export const actions = {
  update: async ({params, request, fetch, url}) => {
    const values = readTournamentFormValues(await request.formData());
    const input = parseTournamentFormValues(values);
    if (!input) {
      return updateFailure(400, values, INVALID_INPUT_MESSAGE);
    }

    const res = await createApiClient(fetch).api.tournaments[':id'].$patch({
      param: {id: params.id},
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
        return updateFailure(
          400,
          values,
          await readErrorMessage(res, INVALID_INPUT_MESSAGE),
        );
      }
      if (res.status === 404) {
        return updateFailure(404, values, '大会が見つかりません');
      }
      return updateFailure(502, values, '大会の更新に失敗しました');
    }

    // `load` re-reads the tournament after the action, so the saved values —
    // the tournament type the import panel below the form is keyed on
    // included — come back from the server rather than being carried here.
    return {
      saved: true,
      error: null,
      values: null,
    } satisfies TournamentUpdateActionResult;
  },
} satisfies Actions;

/**
 * Refuses an update, re-rendering what was typed.
 * @param status The status to answer with.
 * @param values What was submitted.
 * @param message The message to show above the form.
 */
function updateFailure(
  status: number,
  values: TournamentFormValues,
  message: string,
) {
  return fail(status, {
    saved: false,
    error: message,
    values,
  } satisfies TournamentUpdateActionResult);
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
