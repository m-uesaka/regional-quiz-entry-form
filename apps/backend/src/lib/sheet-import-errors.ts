import {SheetFetchError} from './sheet-to-form-definition';

/** How a failed sheet import is answered. */
export interface SheetImportFailure {
  status: 400 | 502 | 503;
  error: string;
}

/**
 * Decides the response for an error thrown while reading or converting a
 * sheet, separating what the caller got wrong from what Google did.
 * @param e The thrown value.
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
  // A ZodError (malformed row data) or a plain Error from the converters
  // (unknown type label, duplicate options, an unreadable date, ...) is
  // also caller-input-shaped, not a server fault.
  return {
    status: 400,
    error: e instanceof Error ? e.message : 'invalid sheet data',
  };
}
