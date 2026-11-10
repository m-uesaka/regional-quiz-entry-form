import {error, fail} from '@sveltejs/kit';
import {
  TOURNAMENT_TYPE_LABELS,
  TournamentOrderInputSchema,
} from '@regional-quiz/shared';
import {createApiClient, isUnauthorized, readErrorMessage} from '$lib/api';
import {redirectToStaffLogin} from '$lib/server/staff-session';
import {sortBySubmittedOrder} from '$lib/submitted-order';
import type {Actions, PageServerLoad} from './$types';

/** One tournament as the reorder screen lists it. */
export interface OrderedTournament {
  id: string;
  regionName: string;
  typeLabel: string;
  name: string;
}

/**
 * What the action hands back. Both branches carry the same properties so
 * the page can read `form.error` without narrowing first.
 */
interface ReorderActionResult {
  saved: boolean;
  error: string | null;
  /**
   * The tournament ids as submitted, in the order they were to be saved
   * in, echoed back so a failed save re-renders the order on screen rather
   * than the stored one. Null when the order on screen should come from
   * the API again: after a save, or when the tournaments changed meanwhile.
   */
  order: string[] | null;
}

// Matches the control names the page renders: `tournaments[0].id` and so
// on. The index identifies the row a control belongs to; the order the
// browser serialized the body in says nothing.
const ROW_CONTROL_PATTERN = /^tournaments\[(\d+)\]\.(id|order)$/;

export const load: PageServerLoad = async ({fetch, cookies, url}) => {
  const api = createApiClient(fetch);
  const [tournamentsRes, regionsRes] = await Promise.all([
    api.api.tournaments.$get(),
    api.api.regions.$get(),
  ]);
  if (isUnauthorized(tournamentsRes) || isUnauthorized(regionsRes)) {
    redirectToStaffLogin(cookies, url);
  }
  if (!tournamentsRes.ok || !regionsRes.ok) {
    error(502, '大会一覧の取得に失敗しました');
  }

  const regionNames = new Map(
    (await regionsRes.json()).map(region => [region.id, region.name]),
  );
  // In the order the API lists them, which is the order being edited.
  const tournaments: OrderedTournament[] = (await tournamentsRes.json()).map(
    tournament => ({
      id: tournament.id,
      regionName: regionNames.get(tournament.regionId) ?? '',
      typeLabel: TOURNAMENT_TYPE_LABELS[tournament.type],
      name: tournament.name,
    }),
  );
  return {tournaments};
};

export const actions = {
  default: async ({request, fetch, cookies, url}) => {
    const tournamentIds = readTournamentOrder(await request.formData());
    const parsed = TournamentOrderInputSchema.safeParse({tournamentIds});
    if (!parsed.success) {
      // The schema's messages are in Japanese and say what is wrong (no
      // tournaments at all, or a duplicated or malformed id).
      return fail(
        400,
        refusal(
          parsed.error.issues[0]?.message ?? '入力内容を確認してください',
          tournamentIds,
        ),
      );
    }

    const res = await createApiClient(fetch).api.tournaments.order.$put({
      json: parsed.data,
    });
    if (!res.ok) {
      if (isUnauthorized(res)) {
        redirectToStaffLogin(cookies, url);
      }
      // 409: a tournament was created or deleted since the screen was
      // opened. The API says so in Japanese, for this screen. The order is
      // not kept: the list it was made from no longer matches the stored
      // one, so the screen starts over from what the API has now.
      if (res.status === 409) {
        return fail(
          409,
          refusal(await readErrorMessage(res, '表示順を保存できません'), null),
        );
      }
      return fail(
        502,
        refusal('表示順の保存に失敗しました', parsed.data.tournamentIds),
      );
    }
    return {
      saved: true,
      error: null,
      order: null,
    } satisfies ReorderActionResult;
  },
} satisfies Actions;

/**
 * Builds a refusal.
 * @param message Why the save was refused.
 * @param order The submitted ids to re-render the list in, or null to
 *     render it in the order the API has.
 */
function refusal(message: string, order: string[] | null): ReorderActionResult {
  return {saved: false, error: message, order};
}

/**
 * The submitted tournament ids, in the order their "表示順" asks for.
 * @param formData The submitted body.
 */
function readTournamentOrder(formData: FormData): string[] {
  const rows = new Map<number, {id: string; order: string}>();
  for (const [name, value] of formData.entries()) {
    const match = ROW_CONTROL_PATTERN.exec(name);
    if (!match) continue;
    const index = Number(match[1]);
    const row = rows.get(index) ?? {id: '', order: ''};
    row[match[2] as 'id' | 'order'] = String(value);
    rows.set(index, row);
  }
  return sortBySubmittedOrder(
    [...rows.entries()]
      .filter(([, row]) => row.id !== '')
      .map(([index, row]) => ({index, order: row.order, value: row.id})),
  );
}
