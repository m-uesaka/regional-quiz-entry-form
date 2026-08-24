import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {SheetImportRequestSchema} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {
  fetchSheetRows,
  sheetRowsToYaml,
  SheetFetchError,
} from '../lib/sheet-to-form-definition';

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
      if (e instanceof SheetFetchError) {
        // A network failure (no status) or a 5xx from Google is an
        // upstream/service fault, not something the caller did wrong.
        if (e.status === undefined || e.status >= 500) {
          console.error('failed to reach Google Sheets', e);
          return c.json(
            {error: 'Google スプレッドシートへの接続に失敗しました'},
            502,
          );
        }
        // A 429 means we're being rate-limited by Google, also not the
        // caller's fault.
        if (e.status === 429) {
          console.error('Google Sheets API rate limit exceeded', e);
          return c.json(
            {
              error:
                'Google スプレッドシートへのリクエストが制限されています。しばらくしてから再試行してください',
            },
            503,
          );
        }
        // Any other non-2xx (400/403/404/...) reflects a bad spreadsheet
        // ID or an inaccessible sheet — a caller-input-shaped failure.
        return c.json({error: e.message}, 400);
      }
      // A ZodError (malformed row data) or a plain Error from
      // sheetRowsToYaml (unknown type label, duplicate options, ...) is
      // also caller-input-shaped, not a server fault.
      const message = e instanceof Error ? e.message : 'invalid sheet data';
      return c.json({error: message}, 400);
    }

    return c.json({yaml});
  });
