import {error, fail, redirect} from '@sveltejs/kit';
import {
  formFieldDefsToYaml,
  TournamentSchema,
  type WaitlistPromotion,
} from '@regional-quiz/shared';
import {createApiClient, isUnauthorized, readErrorMessage} from '$lib/api';
import {
  parseTournamentFormValues,
  readTournamentFormValues,
} from '$lib/tournament-form';
import {redirectToStaffLogin} from '$lib/server/staff-session';
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
  /**
   * What promoting the waitlist into seats a saved capacity freed came to
   * (#223); null when the promotion failed. Only read after a successful
   * save.
   */
  promotion: WaitlistPromotion | null;
}

/** What the delete action hands back when it refuses. */
interface TournamentDeleteActionResult {
  deleteError: string;
}

const INVALID_INPUT_MESSAGE = '入力内容を確認してください';

// Read and written on the server rather than in the browser (this was a
// `+page.ts` calling the API from the client): `/api/*` is only routed to
// the backend Worker for requests the frontend makes itself until Task 9-5
// lands, so a client-side call would 404 in production.
export const load: PageServerLoad = async ({params, fetch, cookies, url}) => {
  // An id that isn't a UUID names no tournament, and is answered here
  // rather than sent on to come back as the API's 400 -- which would then be
  // indistinguishable from any other request the API refused.
  if (!TournamentSchema.shape.id.safeParse(params.id).success) {
    error(404, '大会が見つかりません');
  }

  const api = createApiClient(fetch);
  // Only the tournament being edited, not the whole list to `find` it in
  // (#123). Its form fields come in the same response rather than from
  // `GET /api/form-definitions/:tournamentId`, whose entry-period gate would
  // read the tournament a second time.
  const [tournamentRes, regionsRes] = await Promise.all([
    api.api.tournaments[':id'].$get({param: {id: params.id}}),
    api.api.regions.$get(),
  ]);
  if (isUnauthorized(tournamentRes) || isUnauthorized(regionsRes)) {
    redirectToStaffLogin(cookies, url);
  }
  if (tournamentRes.status === 404) {
    error(404, '大会が見つかりません');
  }
  if (!tournamentRes.ok || !regionsRes.ok) {
    error(502, '大会情報の取得に失敗しました');
  }

  const {tournament, customName, formFieldDefs} = await tournamentRes.json();
  return {
    tournament,
    customName,
    regions: await regionsRes.json(),
    // Written out as the YAML the editor works on, so editing starts from
    // what is stored rather than from a blank page or the spreadsheet.
    formDefinitionYaml: formFieldDefsToYaml(tournament.type, formFieldDefs),
  };
};

export const actions = {
  update: async ({params, request, fetch, cookies, url}) => {
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
        redirectToStaffLogin(cookies, url);
      }
      // 400 is a constraint the database refused — a region that no longer
      // exists, or a second tournament of the same type in it — which the
      // API words in Japanese itself, so it is shown rather than replaced.
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
      promotion: (await res.json()).promotion,
    } satisfies TournamentUpdateActionResult;
  },
  delete: async ({params, request, fetch, cookies, url}) => {
    // The page asks for this tick before the button does anything; a post
    // without it got past the browser's own check.
    if ((await request.formData()).get('confirm') !== 'on') {
      return deleteFailure(400, '削除の確認にチェックを入れてください');
    }

    const res = await createApiClient(fetch).api.tournaments[':id'].$delete({
      param: {id: params.id},
    });
    if (!res.ok) {
      if (isUnauthorized(res)) {
        redirectToStaffLogin(cookies, url);
      }
      // 409: entries still point at the tournament. The API words that in
      // Japanese itself.
      if (res.status === 409) {
        return deleteFailure(
          409,
          await readErrorMessage(res, 'エントリーがある大会は削除できません'),
        );
      }
      if (res.status === 404) {
        return deleteFailure(404, '大会が見つかりません');
      }
      return deleteFailure(502, '大会の削除に失敗しました');
    }

    // Nothing is left to show here, so the list is where the next step is.
    redirect(303, '/admin/tournaments?deleted');
  },
} satisfies Actions;

/**
 * Refuses a delete, with the message to show in the delete section.
 * @param status The status to answer with.
 * @param message The message.
 */
function deleteFailure(status: number, message: string) {
  return fail(status, {
    deleteError: message,
  } satisfies TournamentDeleteActionResult);
}

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
    promotion: null,
  } satisfies TournamentUpdateActionResult);
}
