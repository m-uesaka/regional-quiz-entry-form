import {fail} from '@sveltejs/kit';
import {
  TournamentBulkImportRequestSchema,
  type TournamentImportResult,
} from '@regional-quiz/shared';
import {createApiClient, isUnauthorized, readErrorMessage} from '$lib/api';
import {readString} from '$lib/form-data';
import {redirectToStaffLogin} from '$lib/server/staff-session';
import type {Actions} from './$types';

/**
 * What the action hands back. Every branch carries the same properties so
 * the page can read them without narrowing.
 */
interface ImportActionResult {
  /** Echoed back so the field keeps what was pasted. */
  spreadsheetId: string;
  /** Why nothing was registered at all; null once the sheet was read. */
  error: string | null;
  /** One per row of the sheet; null when the sheet couldn't be read. */
  results: TournamentImportResult[] | null;
}

export const actions = {
  // Registers every tournament on a 大会一覧 spreadsheet (#168). The API
  // writes as it goes -- there is no preview step -- and reports each row,
  // so the page's job is to show which rows made it and why the others
  // didn't.
  default: async ({request, fetch, cookies, url}) => {
    const spreadsheetId = readString(await request.formData(), 'spreadsheetId');

    const parsed = TournamentBulkImportRequestSchema.safeParse({spreadsheetId});
    if (!parsed.success) {
      return failure(400, spreadsheetId, parsed.error.issues[0].message);
    }

    const res = await createApiClient(fetch).api[
      'sheet-import'
    ].tournaments.$post({
      json: parsed.data,
    });
    if (!res.ok) {
      if (isUnauthorized(res)) {
        redirectToStaffLogin(cookies, url);
      }
      // 400 (the sheet can't be read, or lacks a column) and 502/503
      // (Google) come with a message meant for staff; anything else is ours.
      if (res.status === 400 || res.status === 502 || res.status === 503) {
        return failure(
          res.status,
          spreadsheetId,
          await readErrorMessage(res, '大会一覧を読み取れませんでした'),
        );
      }
      return failure(
        502,
        spreadsheetId,
        '一括登録に失敗しました。時間をおいて再度お試しください',
      );
    }

    return {
      spreadsheetId,
      error: null,
      results: (await res.json()).results,
    } satisfies ImportActionResult;
  },
} satisfies Actions;

/**
 * Refuses the import as a whole: nothing was registered.
 * @param status The status to answer with.
 * @param spreadsheetId What was submitted, to re-render.
 * @param message The message to show.
 */
function failure(status: number, spreadsheetId: string, message: string) {
  return fail(status, {
    spreadsheetId,
    error: message,
    results: null,
  } satisfies ImportActionResult);
}
