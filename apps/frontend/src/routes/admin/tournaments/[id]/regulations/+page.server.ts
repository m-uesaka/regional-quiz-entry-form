import {error, fail} from '@sveltejs/kit';
import {
  RegulationSyncInputSchema,
  type Regulation,
} from '@regional-quiz/shared';
import {
  createApiClient,
  isNotFound,
  isUnauthorized,
  readErrorMessage,
} from '$lib/api';
import {fromJstDatetimeLocal} from '$lib/jst-datetime';
import {
  emptyRegulationRow,
  isUntouchedNewRegulationRow,
  toRegulationRow,
} from '$lib/regulation-rows';
import {redirectToStaffLogin} from '$lib/server/staff-session';
import {sortBySubmittedOrder} from '$lib/submitted-order';
import type {RegulationRowValues} from '$lib/types/regulation-form';
import type {Actions, PageServerLoad} from './$types';

/**
 * What the actions hand back. Every branch carries the same properties so
 * the page can read `form.error` without narrowing first.
 */
interface RegulationsActionResult {
  saved: boolean;
  /**
   * Whether `rows` holds a spreadsheet's regulations, read but not yet
   * saved: the page says so, since the form now shows something the
   * database doesn't have.
   */
  imported: boolean;
  error: string | null;
  /**
   * The rows to render in place of the stored ones: the submitted rows,
   * echoed back so a rejected save re-renders what was typed, or the rows
   * built from a spreadsheet. Null after a successful save, where `load` has
   * just re-read the stored rows — including the ids the new ones have only
   * now been given — and after a refused import, which leaves the stored
   * rows on screen.
   */
  rows: RegulationRowValues[] | null;
  /** The spreadsheet ID last submitted for import, to refill its control. */
  spreadsheetId: string;
}

/** What a regulation read from a spreadsheet carries. */
interface ImportedRegulation {
  label: string;
  priorityStartsAt: string | null;
  priorityEndsAt: string | null;
  // Left out for a blank cell, which leaves the stored value as it is.
  closesWithPriority?: boolean;
}

/**
 * Builds a save refusal: the submitted rows are echoed back with the reason.
 * @param error Why the save was refused.
 * @param rows The rows as submitted.
 */
function saveRefusal(
  error: string,
  rows: RegulationRowValues[],
): RegulationsActionResult {
  return {saved: false, imported: false, error, rows, spreadsheetId: ''};
}

/**
 * Builds an import refusal: nothing was read, so the stored rows stay.
 * @param error Why the import was refused.
 * @param spreadsheetId The spreadsheet ID as submitted.
 */
function importRefusal(
  error: string,
  spreadsheetId: string,
): RegulationsActionResult {
  return {saved: false, imported: false, error, rows: null, spreadsheetId};
}

// Matches the control names the page renders: `regulations[0].label` and so
// on. The index identifies the row a control belongs to; the order the
// browser serialized the body in says nothing.
const ROW_CONTROL_PATTERN = /^regulations\[(\d+)\]\.(\w+)$/;

export const load: PageServerLoad = async ({params, fetch, cookies, url}) => {
  const api = createApiClient(fetch);
  // The regulations endpoint sits behind `requireOpenEntryPeriodOrStaff()`,
  // which answers 404 for an id no tournament has — so a mistyped or stale
  // `[id]` is refused rather than rendering a working-looking empty form
  // whose save is the first thing to fail. The tournament list is read
  // alongside it as the check that survives the gate ever being lifted off
  // the regulations endpoint.
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
      redirectToStaffLogin(cookies, url);
    }
    if (isNotFound(regulationsRes)) {
      error(404, '大会が見つかりません');
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
  save: async ({params, request, fetch, cookies, url}) => {
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
      return fail(400, saveRefusal('レギュレーションは1つ以上必要です', rows));
    }
    if (kept.some(row => row.label.trim() === '')) {
      return fail(
        400,
        saveRefusal('レギュレーション名を入力してください', rows),
      );
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
        closesWithPriority: row.closesWithPriority,
      })),
    });
    if (!parsed.success) {
      return fail(
        400,
        // The schema's own messages name the rule that was broken (a
        // half-filled priority window, an end before its start), which is
        // more use here than a generic notice.
        saveRefusal(
          parsed.error.issues[0]?.message ?? '入力内容を確認してください',
          rows,
        ),
      );
    }

    const res = await createApiClient(fetch).api.tournaments[
      ':tournamentId'
    ].regulations.$put({
      param: {tournamentId: params.id},
      json: parsed.data,
    });
    if (!res.ok) {
      if (isUnauthorized(res)) {
        redirectToStaffLogin(cookies, url);
      }
      // 400 names the regulations that don't belong to this tournament and
      // 409 the ones an entry still points at. Both are written by the API
      // in Japanese, for the staff member reading this screen, so they are
      // shown verbatim rather than replaced.
      if (res.status === 400 || res.status === 409) {
        return fail(
          res.status,
          saveRefusal(
            await readErrorMessage(res, 'レギュレーションを保存できません'),
            rows,
          ),
        );
      }
      if (res.status === 404) {
        return fail(404, saveRefusal('大会が見つかりません', rows));
      }
      return fail(
        502,
        saveRefusal('レギュレーションの保存に失敗しました', rows),
      );
    }

    return {
      saved: true,
      imported: false,
      error: null,
      rows: null,
      spreadsheetId: '',
    } satisfies RegulationsActionResult;
  },

  // Reads the regulations region staff listed on their spreadsheet and puts
  // them into the form *without saving*: the form itself is the preview, and
  // the staff member presses "保存" once it reads right. That keeps a single
  // write path (the `save` action above) whichever way the rows were filled.
  import: async ({params, request, fetch, cookies, url}) => {
    const formData = await request.formData();
    const spreadsheetId = String(formData.get('spreadsheetId') ?? '').trim();
    if (spreadsheetId === '') {
      return fail(
        400,
        importRefusal('スプレッドシートIDを入力してください', spreadsheetId),
      );
    }

    const api = createApiClient(fetch);
    const [previewRes, storedRes] = await Promise.all([
      api.api['sheet-import'].regulations.preview.$post({
        json: {spreadsheetId},
      }),
      api.api.tournaments[':tournamentId'].regulations.$get({
        param: {tournamentId: params.id},
      }),
    ]);
    if (isUnauthorized(previewRes) || isUnauthorized(storedRes)) {
      redirectToStaffLogin(cookies, url);
    }
    if (!previewRes.ok) {
      // Written by the API for the staff member reading this screen (the
      // sheet row at fault, the tab that couldn't be read), so shown as is.
      return fail(
        previewRes.status,
        importRefusal(
          await readErrorMessage(
            previewRes,
            'スプレッドシートを読み込めませんでした',
          ),
          spreadsheetId,
        ),
      );
    }
    if (!storedRes.ok) {
      if (isNotFound(storedRes)) {
        return fail(404, importRefusal('大会が見つかりません', spreadsheetId));
      }
      return fail(
        502,
        importRefusal('レギュレーションの取得に失敗しました', spreadsheetId),
      );
    }

    const {regulations} = await previewRes.json();
    return {
      saved: false,
      imported: true,
      error: null,
      rows: mergeImportedRegulations(regulations, await storedRes.json()),
      spreadsheetId,
    } satisfies RegulationsActionResult;
  },
} satisfies Actions;

/**
 * Lays a spreadsheet's regulations over the stored ones, as form rows.
 *
 * The sheet carries no ids, so a sheet regulation is paired with the stored
 * one of the same name and becomes an update of it — which is what keeps
 * existing entries pointing at their regulation when only its priority
 * window or its position changed. A name the tournament doesn't have yet is
 * a new row. A blank "優先期間後" cell keeps the stored regulation's setting.
 *
 * Stored regulations the sheet no longer lists follow, ticked for removal
 * rather than dropped: the staff member sees what the import is about to
 * delete and can untick it, and a regulation an entry still uses is refused
 * by the save with a message naming it instead of vanishing from the form.
 *
 * @param imported The sheet's regulations, in sheet order.
 * @param stored The tournament's current regulations.
 * @return The rows to render, sheet rows first.
 */
function mergeImportedRegulations(
  imported: ImportedRegulation[],
  stored: Regulation[],
): RegulationRowValues[] {
  const unmatched = [...stored];
  const rows = imported.map(regulation => {
    const index = unmatched.findIndex(
      candidate => candidate.label === regulation.label,
    );
    const [match] = index === -1 ? [] : unmatched.splice(index, 1);
    return toRegulationRow({
      ...regulation,
      id: match?.id,
      closesWithPriority:
        regulation.closesWithPriority ?? match?.closesWithPriority,
    });
  });
  return [
    ...rows,
    ...unmatched.map(regulation => ({
      ...toRegulationRow(regulation),
      remove: true,
    })),
  ];
}

/**
 * Rebuilds the submitted rows in the order they are to be stored in.
 *
 * The controls are named `regulations[i].field`, so a row is assembled from
 * the controls sharing an index and the rows are then put in the order their
 * "表示順" asks for (`sortBySubmittedOrder()`). A gap in the indices is
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
      case 'closesWithPriorityControl':
        // Rendered beside the box, so a box left unticked can be told from
        // a page that had no box at all.
        row.closesWithPriority ??= false;
        break;
      case 'closesWithPriority':
        row.closesWithPriority = true;
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
  return sortBySubmittedOrder(
    [...rows.entries()].map(([index, row]) => ({
      index,
      order: row.order,
      value: row,
    })),
  );
}
