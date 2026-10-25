import {z} from 'zod';
import {TournamentTypeSchema} from './tournament';

// The path segment a Google Sheets URL carries its spreadsheet ID in:
// `https://docs.google.com/spreadsheets/d/{id}/edit#gid=0`.
const SPREADSHEET_URL_PATTERN = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/;

/**
 * The spreadsheet ID in what staff pasted: the ID itself, or the URL of the
 * spreadsheet, which is what the browser's address bar hands them.
 * @param input The pasted text, already trimmed.
 */
export function spreadsheetIdFromInput(input: string): string {
  return SPREADSHEET_URL_PATTERN.exec(input)?.[1] ?? input;
}

// Request body of `POST /api/sheet-import/tournaments` (#168): the 大会一覧
// spreadsheet to register every tournament from. Its URL is accepted as
// well as its ID.
export const TournamentBulkImportRequestSchema = z.object({
  spreadsheetId: z
    .string()
    .trim()
    .min(1, {message: 'スプレッドシートの ID または URL を入力してください'})
    .transform(spreadsheetIdFromInput),
});
export type TournamentBulkImportRequest = z.infer<
  typeof TournamentBulkImportRequestSchema
>;

// What happened to one row of the 大会一覧 sheet. `created` / `updated`
// mean the tournament, its form definition and its regulations were all
// written; `failed` means nothing of that tournament was, and `error` says
// why -- staff register those by hand.
export const TournamentImportOutcomeSchema = z.enum([
  'created',
  'updated',
  'failed',
]);
export type TournamentImportOutcome = z.infer<
  typeof TournamentImportOutcomeSchema
>;

export const TournamentImportResultSchema = z.object({
  /** The row of the 大会一覧 sheet, as the sheet numbers it. */
  row: z.number().int().positive(),
  /** The 地域 / 種別 cells as written, so a failed row can be found. */
  regionName: z.string(),
  typeLabel: z.string(),
  outcome: TournamentImportOutcomeSchema,
  /** Set when the tournament was written. */
  tournamentId: z.string().uuid().nullable(),
  type: TournamentTypeSchema.nullable(),
  entryOpensAt: z.string().datetime({offset: true}).nullable(),
  entryClosesAt: z.string().datetime({offset: true}).nullable(),
  /** Set when `outcome` is `failed`; staff-facing Japanese. */
  error: z.string().nullable(),
});
export type TournamentImportResult = z.infer<
  typeof TournamentImportResultSchema
>;

export const TournamentBulkImportResponseSchema = z.object({
  results: z.array(TournamentImportResultSchema),
});
export type TournamentBulkImportResponse = z.infer<
  typeof TournamentBulkImportResponseSchema
>;
