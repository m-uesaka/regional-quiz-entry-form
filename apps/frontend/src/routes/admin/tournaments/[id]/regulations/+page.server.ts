import {error, fail, redirect} from '@sveltejs/kit';
import {RegulationSyncInputSchema} from '@regional-quiz/shared';
import {createApiClient, isUnauthorized} from '$lib/api';
import {fromJstDatetimeLocal} from '$lib/jst-datetime';
import {
  emptyRegulationRow,
  isUntouchedNewRegulationRow,
} from '$lib/regulation-rows';
import {staffLoginPath} from '$lib/server/staff-login';
import type {RegulationRowValues} from '$lib/types/regulation-form';
import type {Actions, PageServerLoad} from './$types';

/**
 * What the action hands back. The successful branch carries the same
 * properties as the refusals so the page can read `form.error` without
 * narrowing first.
 */
interface RegulationsActionResult {
  saved: boolean;
  error: string | null;
  /**
   * The submitted rows, echoed back so a rejected save re-renders what was
   * typed. Null after a successful save, where `load` has just re-read the
   * stored rows — including the ids the new ones have only now been given.
   */
  rows: RegulationRowValues[] | null;
}

// Matches the control names the page renders: `regulations[0].label` and so
// on. The index identifies the row a control belongs to; the order the
// browser serialized the body in says nothing.
const ROW_CONTROL_PATTERN = /^regulations\[(\d+)\]\.(\w+)$/;

export const load: PageServerLoad = async ({params, fetch, url}) => {
  const api = createApiClient(fetch);
  // The regulations endpoint is public and answers `200 []` for any
  // well-formed id, so a mistyped or stale `[id]` would otherwise render a
  // working-looking empty form whose save is the first thing to 404. The
  // tournament list settles that the tournament exists — and, being the
  // staff-only request of the two, is what makes the 401 below reachable.
  const [tournamentsRes, regulationsRes] = await Promise.all([
    api.api.tournaments.$get(),
    api.api.tournaments[':tournamentId'].regulations.$get({
      param: {tournamentId: params.id},
    }),
  ]);
  if (!tournamentsRes.ok || !regulationsRes.ok) {
    // The layout guard cannot rule this out: the JWT may expire between
    // `hooks.server.ts` parsing it and these requests reaching the backend.
    if (isUnauthorized(tournamentsRes) || isUnauthorized(regulationsRes)) {
      redirect(303, staffLoginPath(url));
    }
    error(502, 'レギュレーションの取得に失敗しました');
  }

  // `GET /api/tournaments/:id` doesn't exist (only list + create + update),
  // so the tournament being edited is picked out of the full list.
  const tournaments = await tournamentsRes.json();
  if (!tournaments.some(tournament => tournament.id === params.id)) {
    error(404, '大会が見つかりません');
  }

  return {regulations: await regulationsRes.json()};
};

export const actions = {
  default: async ({params, request, fetch, url}) => {
    const rows = readRegulationRows(await request.formData());

    // The rows are sent as the whole set the tournament should end up with,
    // so a row ticked for removal is simply left out — and the blank row the
    // page always renders last is too, unless something was typed into it.
    const kept = rows.filter(
      row => !row.remove && !isUntouchedNewRegulationRow(row),
    );
    // Both of these are refused by the schema too, but only in English —
    // `min(1)` and the label's own length check carry Zod's default
    // wording, and this screen is read in Japanese. Everything the schema
    // refuses below already says why in Japanese.
    if (kept.length === 0) {
      return fail(400, {
        saved: false,
        error: 'レギュレーションは1つ以上必要です',
        rows,
      } satisfies RegulationsActionResult);
    }
    if (kept.some(row => row.label.trim() === '')) {
      return fail(400, {
        saved: false,
        error: 'レギュレーション名を入力してください',
        rows,
      } satisfies RegulationsActionResult);
    }

    const parsed = RegulationSyncInputSchema.safeParse({
      regulations: kept.map(row => ({
        // An id names an existing regulation to update; a row without one
        // is added. The array order becomes `display_order`, so nothing is
        // numbered here.
        id: row.id === '' ? undefined : row.id,
        label: row.label,
        priorityStartsAt: fromJstDatetimeLocal(row.priorityStartsAt),
        priorityEndsAt: fromJstDatetimeLocal(row.priorityEndsAt),
      })),
    });
    if (!parsed.success) {
      return fail(400, {
        saved: false,
        // The schema's own messages name the rule that was broken (a
        // half-filled priority window, an end before its start), which is
        // more use here than a generic notice.
        error: parsed.error.issues[0]?.message ?? '入力内容を確認してください',
        rows,
      } satisfies RegulationsActionResult);
    }

    const res = await createApiClient(fetch).api.tournaments[
      ':tournamentId'
    ].regulations.$put({
      param: {tournamentId: params.id},
      json: parsed.data,
    });
    if (!res.ok) {
      if (isUnauthorized(res)) {
        redirect(303, staffLoginPath(url));
      }
      // 400 names the regulations that don't belong to this tournament and
      // 409 the ones an entry still points at. Both are written by the API
      // in Japanese, for the staff member reading this screen, so they are
      // shown verbatim rather than replaced.
      if (res.status === 400 || res.status === 409) {
        return fail(res.status, {
          saved: false,
          error: await readErrorMessage(
            res,
            'レギュレーションを保存できません',
          ),
          rows,
        } satisfies RegulationsActionResult);
      }
      if (res.status === 404) {
        return fail(404, {
          saved: false,
          error: '大会が見つかりません',
          rows,
        } satisfies RegulationsActionResult);
      }
      return fail(502, {
        saved: false,
        error: 'レギュレーションの保存に失敗しました',
        rows,
      } satisfies RegulationsActionResult);
    }

    return {
      saved: true,
      error: null,
      rows: null,
    } satisfies RegulationsActionResult;
  },
} satisfies Actions;

/**
 * Rebuilds the submitted rows in the order they are to be stored in.
 *
 * The controls are named `regulations[i].field`, so a row is assembled from
 * the controls sharing an index and the rows are then put in the order their
 * "表示順" asks for — see the note on the sort below. A gap in the indices is
 * fine: only the relative order matters.
 *
 * @param formData The submitted body.
 * @return The rows, in the order they should be saved in.
 */
function readRegulationRows(formData: FormData): RegulationRowValues[] {
  const rows = new Map<number, RegulationRowValues>();
  for (const [name, value] of formData.entries()) {
    const match = ROW_CONTROL_PATTERN.exec(name);
    if (!match) continue;
    const index = Number(match[1]);
    const row = rows.get(index) ?? emptyRegulationRow();
    switch (match[2]) {
      case 'id':
        row.id = String(value);
        break;
      case 'order':
        row.order = String(value);
        break;
      case 'label':
        row.label = String(value);
        break;
      case 'priorityStartsAt':
        row.priorityStartsAt = String(value);
        break;
      case 'priorityEndsAt':
        row.priorityEndsAt = String(value);
        break;
      case 'remove':
        // A checkbox submits nothing at all when it is left unticked, so
        // its mere presence is the answer.
        row.remove = true;
        break;
      default:
        // A control this action doesn't know about; ignored rather than
        // guessed at.
        break;
    }
    rows.set(index, row);
  }
  // Sorted by the "表示順" the form carries, which the page pre-fills with
  // each row's current position — so a form nobody reordered saves in the
  // order it was rendered in, and moving a row is a matter of rewriting its
  // number.
  //
  // Ties are broken by whether the number was rewritten at all: a row asking
  // for a position it was not already in takes it, and the rows left where
  // they were close up behind it in the order they were displayed. Without
  // that, typing `1` into the third of three rows — the one gesture the page
  // tells staff to use — would leave it behind the row already numbered `1`,
  // so nothing could ever be moved to the front.
  return [...rows.entries()]
    .sort(([leftIndex, left], [rightIndex, right]) => {
      const byPosition =
        rowPosition(leftIndex, left) - rowPosition(rightIndex, right);
      if (byPosition !== 0) return byPosition;
      const byMove = moveRank(leftIndex, left) - moveRank(rightIndex, right);
      if (byMove !== 0) return byMove;
      return leftIndex - rightIndex;
    })
    .map(([, row]) => row);
}

/**
 * How a row ranks among others claiming the same position: a row whose
 * "表示順" was rewritten goes ahead of one that still carries the number the
 * page pre-filled it with.
 * @param index The row's index in the rendered form.
 * @param row The submitted row.
 * @return 0 for a row that was moved, 1 for one that was left alone.
 */
function moveRank(index: number, row: RegulationRowValues): number {
  return rowPosition(index, row) === index + 1 ? 1 : 0;
}

/**
 * Where a row asked to be placed, on the 1-based scale the control shows.
 * @param index The row's index in the rendered form.
 * @param row The submitted row.
 * @return The requested position, or the row's own position when the
 *     control was left empty or holds something that isn't a number.
 */
function rowPosition(index: number, row: RegulationRowValues): number {
  if (row.order.trim() === '') return index + 1;
  const requested = Number(row.order);
  return Number.isFinite(requested) ? requested : index + 1;
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
