import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {
  RegulationSheetImportRequestSchema,
  SheetImportRequestSchema,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {
  fetchSheetRows,
  sheetRowsToYaml,
  SheetFetchError,
} from '../lib/sheet-to-form-definition';
import {
  fetchRegulationSheetValues,
  sheetValuesToRegulations,
} from '../lib/sheet-to-regulations';

/** How a failed sheet import is answered. */
interface SheetImportFailure {
  status: 400 | 502 | 503;
  error: string;
}

/**
 * Decides the response for an error thrown while reading or converting a
 * sheet, separating what the caller got wrong from what Google did.
 * @param e The thrown value.
 */
function classifySheetImportError(e: unknown): SheetImportFailure {
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

export const sheetImportRoute = new Hono<StaffEnv>()
  .use('*', requireGeneralStaff())
  .post('/preview', zValidator('json', SheetImportRequestSchema), async c => {
    const {spreadsheetId, tournamentSlug} = c.req.valid('json');

    let yaml;
    try {
      const rows = await fetchSheetRows(
        spreadsheetId,
        c.env.GOOGLE_SHEETS_API_KEY,
      );
      yaml = sheetRowsToYaml(tournamentSlug, rows);
    } catch (e: unknown) {
      const failure = classifySheetImportError(e);
      return c.json({error: failure.error}, failure.status);
    }

    return c.json({yaml});
  })
  // Like the form-definition preview, this writes nothing: it only turns
  // the sheet's regulation tab into the shape the regulation save API
  // takes. The staff member reviews the result on the regulation screen and
  // saves it through `PUT /api/tournaments/:tournamentId/regulations`.
  .post(
    '/regulations/preview',
    zValidator('json', RegulationSheetImportRequestSchema),
    async c => {
      const {spreadsheetId} = c.req.valid('json');

      let regulations;
      try {
        const rows = await fetchRegulationSheetValues(
          spreadsheetId,
          c.env.GOOGLE_SHEETS_API_KEY,
        );
        regulations = sheetValuesToRegulations(rows);
      } catch (e: unknown) {
        const failure = classifySheetImportError(e);
        return c.json({error: failure.error}, failure.status);
      }

      return c.json({regulations});
    },
  );
