import {Hono, type Context} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {
  RegulationSheetImportRequestSchema,
  SheetImportRequestSchema,
  TournamentBulkImportExecuteRequestSchema,
  TournamentBulkImportRequestSchema,
  type TournamentBulkImportPreviewResponse,
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
  previewTournamentImport,
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
  // Reads a 大会一覧 spreadsheet (#168) and says, row by row, whether
  // registering it would create a tournament or overwrite the one there
  // (and what that one holds now), or why it can't be registered. Like the
  // previews above, this writes nothing: staff choose on the import screen
  // which tournaments to go ahead with, and `POST /tournaments` below
  // registers those.
  //
  // 200 whenever the sheet itself could be read, however many rows can't be
  // registered. Only a sheet that can't be read or lacks a column fails the
  // request as a whole.
  .post(
    '/tournaments/preview',
    zValidator('json', TournamentBulkImportRequestSchema),
    async c => {
      let rows;
      try {
        rows = await previewTournamentImport(
          c.env,
          c.req.valid('json').spreadsheetId,
          new Date(),
        );
      } catch (e: unknown) {
        return indexFailure(c, e, 'failed to preview the tournament import');
      }
      const body: TournamentBulkImportPreviewResponse = {rows};
      return c.json(body);
    },
  )
  // Registers the tournaments chosen from a 大会一覧 spreadsheet, reading it
  // again. Each one's tournament, form definition and regulations are saved
  // in one transaction, and one that fails is reported and left alone while
  // the rest go ahead. Each selection says whether to create or overwrite,
  // as the preview offered; one whose tournament has since been created or
  // deleted fails rather than doing the other.
  .post(
    '/tournaments',
    zValidator('json', TournamentBulkImportExecuteRequestSchema),
    async c => {
      const {spreadsheetId, selections} = c.req.valid('json');
      let results;
      try {
        results = await importTournaments(
          c.env,
          spreadsheetId,
          selections,
          new Date(),
        );
      } catch (e: unknown) {
        return indexFailure(c, e, 'failed to import the tournaments');
      }
      const body: TournamentBulkImportResponse = {results};
      return c.json(body);
    },
  );

/**
 * The answer for a 大会一覧 sheet that couldn't be used as a whole.
 * @param c The request context.
 * @param e What was thrown.
 * @param message What to log for anything that isn't the sheet's fault.
 */
function indexFailure(c: Context<StaffEnv>, e: unknown, message: string) {
  if (e instanceof TournamentIndexError) {
    return c.json({error: e.message}, 400);
  }
  if (e instanceof SheetFetchError) {
    const failure = classifySheetImportError(e);
    return c.json({error: failure.error}, failure.status);
  }
  return c.json(internalError(message, e), 500);
}
