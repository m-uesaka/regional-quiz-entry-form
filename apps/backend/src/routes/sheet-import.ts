import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {
  RegulationSheetImportRequestSchema,
  SheetImportRequestSchema,
  TournamentBulkImportRequestSchema,
  type TournamentBulkImportResponse,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {internalError} from '../lib/errors';
import {classifySheetImportError} from '../lib/sheet-import-errors';
import {
  fetchSheetRows,
  SheetFetchError,
  sheetRowsToYaml,
} from '../lib/sheet-to-form-definition';
import {
  fetchRegulationSheetValues,
  sheetValuesToRegulations,
} from '../lib/sheet-to-regulations';
import {
  importTournaments,
  TournamentIndexError,
} from '../lib/tournament-bulk-import';

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
  )
  // Registers every tournament on a 大会一覧 spreadsheet (#168). Unlike the
  // two previews above, this *does* write: each row's tournament, form
  // definition and regulations are saved in one transaction per row, and a
  // row that fails is reported and left alone while the rest go ahead.
  // An existing tournament for the same region and type is overwritten.
  //
  // 200 whenever the sheet itself could be read, however many rows failed:
  // the per-row outcomes are the answer. Only a sheet that can't be read or
  // lacks a column fails the request as a whole.
  .post(
    '/tournaments',
    zValidator('json', TournamentBulkImportRequestSchema),
    async c => {
      let results;
      try {
        results = await importTournaments(
          c.env,
          c.req.valid('json').spreadsheetId,
          new Date(),
        );
      } catch (e: unknown) {
        if (e instanceof TournamentIndexError) {
          return c.json({error: e.message}, 400);
        }
        if (e instanceof SheetFetchError) {
          const failure = classifySheetImportError(e);
          return c.json({error: failure.error}, failure.status);
        }
        return c.json(
          internalError('failed to import the tournaments', e),
          500,
        );
      }
      const body: TournamentBulkImportResponse = {results};
      return c.json(body);
    },
  );
