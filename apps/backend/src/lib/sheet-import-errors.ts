import {SheetFetchError} from './google-sheets';
import {FormSheetError} from './sheet-to-form-definition';
import {RegulationSheetError} from './sheet-to-regulations';

/** How a failed sheet import is answered. */
export interface SheetImportFailure {
  status: 400 | 502 | 503;
  error: string;
}

/**
 * Decides the response for an error thrown while reading or converting a
 * sheet, separating what the caller got wrong from what Google did.
 *
 * Only the errors a sheet import is known to throw are answered here.
 * Anything else -- a `SyntaxError` from a 200 that wasn't JSON, a
 * `TypeError` from a grid of an unexpected shape -- is a server fault whose
 * message says nothing staff can act on, so it is thrown again for the
 * caller to log and answer as a 500 (#293).
 * @param e The thrown value.
 * @throws The thrown value itself, if it is none of those errors.
 */
export function classifySheetImportError(e: unknown): SheetImportFailure {
  if (e instanceof SheetFetchError) {
    // A network failure (no status) or a 5xx from Google is an
    // upstream/service fault, not something the caller did wrong.
    if (e.status === undefined || e.status >= 500) {
      console.error('failed to reach Google Sheets', e);
      return {
        status: 502,
        error: 'Google スプレッドシートへの接続に失敗しました',
      };
    }
    // A 429 means we're being rate-limited by Google, also not the
    // caller's fault.
    if (e.status === 429) {
      console.error('Google Sheets API rate limit exceeded', e);
      return {
        status: 503,
        error:
          'Google スプレッドシートへのリクエストが制限されています。しばらくしてから再試行してください',
      };
    }
    // Any other non-2xx (400/403/404/...) reflects a bad spreadsheet
    // ID or an inaccessible sheet — a caller-input-shaped failure.
    return {status: 400, error: e.message};
  }
  // The converters' own errors are staff-facing Japanese naming the sheet
  // row, and caller-input-shaped rather than a server fault.
  if (e instanceof FormSheetError || e instanceof RegulationSheetError) {
    return {status: 400, error: e.message};
  }
  throw e;
}
