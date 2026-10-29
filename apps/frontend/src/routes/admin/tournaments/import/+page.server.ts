import {fail, type Cookies} from '@sveltejs/kit';
import {
  TournamentBulkImportExecuteRequestSchema,
  TournamentBulkImportRequestSchema,
  TournamentImportSelectionSchema,
  type TournamentImportPreviewRow,
  type TournamentImportSelection,
  type TournamentImportResult,
} from '@regional-quiz/shared';
import {createApiClient, isUnauthorized, readErrorMessage} from '$lib/api';
import {readString} from '$lib/form-data';
import {redirectToStaffLogin} from '$lib/server/staff-session';
import type {Actions} from './$types';

/**
 * What either action hands back. Every branch carries the same properties
 * so the page can read them without narrowing.
 */
interface ImportActionResult {
  /** Echoed back so the field keeps what was pasted. */
  spreadsheetId: string;
  /** Why the sheet couldn't be used at all; null once it was read. */
  error: string | null;
  /** What registering each row would do; set by `preview` only. */
  rows: TournamentImportPreviewRow[] | null;
  /** What registering the chosen rows did; set by `execute` only. */
  results: TournamentImportResult[] | null;
}

/**
 * The rows chosen on the preview. Each checkbox carries its row's selection
 * as JSON, so the row's names and the action the preview offered travel
 * together.
 * @return The selections, or `null` if one isn't a selection.
 */
function readSelections(
  formData: FormData,
): TournamentImportSelection[] | null {
  const selections: TournamentImportSelection[] = [];
  for (const value of formData.getAll('selection')) {
    let json: unknown;
    try {
      json = JSON.parse(String(value));
    } catch {
      return null;
    }
    const parsed = TournamentImportSelectionSchema.safeParse(json);
    if (!parsed.success) {
      return null;
    }
    selections.push(parsed.data);
  }
  return selections;
}

export const actions = {
  // Reads a 大会一覧 spreadsheet (#168) and shows what registering each row
  // would do. Nothing is written: staff choose on the page which
  // tournaments to create or overwrite and send those to `execute`.
  preview: async ({request, fetch, cookies, url}) => {
    const spreadsheetId = readString(await request.formData(), 'spreadsheetId');

    const parsed = TournamentBulkImportRequestSchema.safeParse({spreadsheetId});
    if (!parsed.success) {
      return failure(400, spreadsheetId, parsed.error.issues[0].message);
    }

    const res = await createApiClient(fetch).api['sheet-import'].tournaments[
      'preview'
    ].$post({json: parsed.data});
    if (!res.ok) {
      return apiFailure(res, spreadsheetId, cookies, url, '読み込み');
    }

    return {
      spreadsheetId,
      error: null,
      rows: (await res.json()).rows,
      results: null,
    } satisfies ImportActionResult;
  },

  // Registers the tournaments chosen on the preview. The API reads the
  // sheets again and reports each one, so the page's job is to show which
  // made it and why the others didn't.
  execute: async ({request, fetch, cookies, url}) => {
    const formData = await request.formData();
    const spreadsheetId = readString(formData, 'spreadsheetId');

    const selections = readSelections(formData);
    if (selections === null) {
      return failure(
        400,
        spreadsheetId,
        '選択した大会を読み取れません。もう一度読み込んでください',
      );
    }
    const parsed = TournamentBulkImportExecuteRequestSchema.safeParse({
      spreadsheetId,
      selections,
    });
    if (!parsed.success) {
      return failure(400, spreadsheetId, parsed.error.issues[0].message);
    }

    const res = await createApiClient(fetch).api[
      'sheet-import'
    ].tournaments.$post({json: parsed.data});
    if (!res.ok) {
      return apiFailure(res, spreadsheetId, cookies, url, '一括登録');
    }

    return {
      spreadsheetId,
      error: null,
      rows: null,
      results: (await res.json()).results,
    } satisfies ImportActionResult;
  },
} satisfies Actions;

/**
 * The answer for an API call that failed as a whole.
 * @param res The API's answer.
 * @param spreadsheetId What was submitted, to re-render.
 * @param cookies The request's cookies, for an expired session.
 * @param url The page's URL, to come back to after logging in.
 * @param what What was being done, for the message.
 */
async function apiFailure(
  res: {status: number; json(): Promise<unknown>},
  spreadsheetId: string,
  cookies: Cookies,
  url: URL,
  what: string,
) {
  if (isUnauthorized(res)) {
    redirectToStaffLogin(cookies, url);
  }
  // 400 (the sheet can't be read, or lacks a column) and 502/503 (Google)
  // come with a message meant for staff; anything else is ours.
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
    `${what}に失敗しました。時間をおいて再度お試しください`,
  );
}

/**
 * Refuses the request as a whole: nothing was read or registered.
 * @param status The status to answer with.
 * @param spreadsheetId What was submitted, to re-render.
 * @param message The message to show.
 */
function failure(status: number, spreadsheetId: string, message: string) {
  return fail(status, {
    spreadsheetId,
    error: message,
    rows: null,
    results: null,
  } satisfies ImportActionResult);
}
