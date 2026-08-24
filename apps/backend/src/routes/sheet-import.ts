import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {fetchSheetRows, sheetRowsToYaml} from '../lib/sheet-to-form-definition';

const SheetImportSchema = z.object({
  spreadsheetId: z.string(),
  tournamentSlug: z.string(),
});

export const sheetImportRoute = new Hono<StaffEnv>()
  .use('*', requireGeneralStaff())
  .post('/preview', zValidator('json', SheetImportSchema), async c => {
    const {spreadsheetId, tournamentSlug} = c.req.valid('json');

    let yaml;
    try {
      const rows = await fetchSheetRows(
        spreadsheetId,
        c.env.GOOGLE_SHEETS_API_KEY,
      );
      yaml = sheetRowsToYaml(tournamentSlug, rows);
    } catch (e: unknown) {
      // Both a fetch failure (bad spreadsheet ID/access) and a Zod
      // validation error (malformed row data) are caller-input-shaped
      // failures, not server faults.
      const message = e instanceof Error ? e.message : 'invalid sheet data';
      return c.json({error: message}, 400);
    }

    return c.json({yaml});
  });
