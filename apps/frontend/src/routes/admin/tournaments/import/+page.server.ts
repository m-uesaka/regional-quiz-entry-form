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
import {
  dropCachedEntryList,
  promotionMayChangeEntryList,
} from '$lib/server/entry-list-cache';
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
      return apiFailure(res, spreadsheetId, cookies, url, {
        what: '読み込み',
        rejected: '大会一覧を読み取れませんでした',
      });
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
  execute: async ({request, fetch, cookies, platform, url}) => {
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

    const api = createApiClient(fetch);
    const res = await api.api['sheet-import'].tournaments.$post({
      json: parsed.data,
    });
    if (!res.ok) {
      return apiFailure(res, spreadsheetId, cookies, url, {
        what: '一括登録',
        rejected:
          '選択した大会を登録できませんでした。もう一度読み込んでください',
      });
    }

    const {results} = await res.json();
    await dropOverwrittenLists(api, platform, url.origin, results);

    return {
      spreadsheetId,
      error: null,
      rows: null,
      results,
    } satisfies ImportActionResult;
  },
} satisfies Actions;

/**
 * Drops the cached public lists an overwrite changed (#307): those whose
 * new capacity promoted the waitlist. A new tournament has no entries yet,
 * and an overwrite that promoted nobody leaves its list as it was.
 *
 * A result names its region as the sheet's 地域 cell does, which the API
 * matched against the regions' names exactly -- and only when one region
 * has that name -- so the same match against the regions finds the slug
 * the list is keyed on. One read covers every row; if it fails, the lists
 * catch up when their cached copies expire.
 * @param api The API client to read the regions with.
 * @param platform The request's platform, absent under `vite dev`.
 * @param origin The request's origin, which the cache keys are under.
 * @param results What registering each chosen row did.
 */
async function dropOverwrittenLists(
  api: ReturnType<typeof createApiClient>,
  platform: App.Platform | undefined,
  origin: string,
  results: TournamentImportResult[],
): Promise<void> {
  const changed = results.filter(
    result =>
      result.outcome === 'updated' &&
      promotionMayChangeEntryList(result.promotion),
  );
  // Nothing is cached without a platform (`vite dev`), so nothing needs
  // reading.
  if (!platform || changed.length === 0) {
    return;
  }
  const res = await api.api.regions.$get().catch(() => null);
  if (!res?.ok) {
    return;
  }
  const regions = await res.json();
  for (const {regionName, type} of changed) {
    const named = regions.filter(region => region.name === regionName);
    if (named.length === 1 && type !== null) {
      await dropCachedEntryList(platform, origin, {
        regionSlug: named[0].slug,
        type,
      });
    }
  }
}

/**
 * The answer for an API call that failed as a whole.
 * @param res The API's answer.
 * @param spreadsheetId What was submitted, to re-render.
 * @param cookies The request's cookies, for an expired session.
 * @param url The page's URL, to come back to after logging in.
 * @param messages What was being done, and what to say when the API
 *     refused the request without a message meant for staff (a 400 from
 *     its request validation).
 */
async function apiFailure(
  res: {status: number; json(): Promise<unknown>},
  spreadsheetId: string,
  cookies: Cookies,
  url: URL,
  messages: {what: string; rejected: string},
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
      await readErrorMessage(res, messages.rejected),
    );
  }
  return failure(
    502,
    spreadsheetId,
    `${messages.what}に失敗しました。時間をおいて再度お試しください`,
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
