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

// The 大会一覧 spreadsheet's ID, or its URL.
const IndexSpreadsheetIdSchema = z
  .string()
  .trim()
  .min(1, {message: 'スプレッドシートの ID または URL を入力してください'})
  .transform(spreadsheetIdFromInput);

// Request body of `POST /api/sheet-import/tournaments/preview` (#168): the
// 大会一覧 spreadsheet to read. Nothing is written; the answer says, row by
// row, what registering it would do.
export const TournamentBulkImportRequestSchema = z.object({
  spreadsheetId: IndexSpreadsheetIdSchema,
});
export type TournamentBulkImportRequest = z.infer<
  typeof TournamentBulkImportRequestSchema
>;

// What registering a row does: create a tournament, or overwrite the one
// already registered for the same region and type.
export const TournamentImportActionSchema = z.enum(['create', 'overwrite']);
export type TournamentImportAction = z.infer<
  typeof TournamentImportActionSchema
>;

// One tournament staff chose to register on the preview screen. A row is
// named by its 地域 / 種別 cells rather than its row number, so a row moved
// on the sheet since the preview is still the one meant. `action` and
// `fingerprint` are what the preview offered and showed: if the tournament
// has since been created or deleted by someone else, or the sheet or the
// tournament changed, the row fails rather than writing what staff never
// saw.
export const TournamentImportSelectionSchema = z.object({
  regionName: z.string(),
  typeLabel: z.string(),
  action: TournamentImportActionSchema,
  fingerprint: z.string().min(1),
});
export type TournamentImportSelection = z.infer<
  typeof TournamentImportSelectionSchema
>;

/** The most tournaments one registration may choose. */
export const MAX_SELECTIONS = 200;

// Request body of `POST /api/sheet-import/tournaments`: registers the
// chosen rows of the 大会一覧 spreadsheet, reading it again.
export const TournamentBulkImportExecuteRequestSchema = z.object({
  spreadsheetId: IndexSpreadsheetIdSchema,
  selections: z
    .array(TournamentImportSelectionSchema)
    .min(1, {message: '登録する大会を選んでください'})
    // Far more than there are regions times types; the bound keeps a forged
    // request from making the API read one spreadsheet per element.
    .max(MAX_SELECTIONS, {message: '一度に登録できる大会が多すぎます'})
    // Two selections of one tournament would write it twice at once.
    .refine(
      selections =>
        new Set(selections.map(s => `${s.regionName}\u0000${s.typeLabel}`))
          .size === selections.length,
      {message: '同じ大会が複数選ばれています'},
    ),
});
export type TournamentBulkImportExecuteRequest = z.infer<
  typeof TournamentBulkImportExecuteRequestSchema
>;

const InstantSchema = z.string().datetime({offset: true});

// The tournament already registered for a row's region and type, as it is
// now, so the preview can show what an overwrite would change.
export const TournamentImportCurrentSchema = z.object({
  tournamentId: z.string().uuid(),
  name: z.string(),
  capacity: z.number().int().positive().nullable(),
  entryOpensAt: InstantSchema,
  entryClosesAt: InstantSchema,
});
export type TournamentImportCurrent = z.infer<
  typeof TournamentImportCurrentSchema
>;

export const TournamentImportPreviewRowSchema = z.object({
  /** The row of the 大会一覧 sheet, as the sheet numbers it. */
  row: z.number().int().positive(),
  /** The 地域 / 種別 cells as written; they name the row on execute. */
  regionName: z.string(),
  typeLabel: z.string(),
  /** What registering the row would do; null when it can't be registered. */
  action: TournamentImportActionSchema.nullable(),
  /** Sent back with the selection; null when it can't be registered. */
  fingerprint: z.string().nullable(),
  /** Set when `action` is null; staff-facing Japanese. */
  error: z.string().nullable(),
  /** The values the sheet gives; null when the row can't be registered. */
  capacity: z.number().int().positive().nullable(),
  entryOpensAt: InstantSchema.nullable(),
  entryClosesAt: InstantSchema.nullable(),
  /** The labels of the form's extra fields and of the regulations. */
  formFieldLabels: z.array(z.string()),
  regulationLabels: z.array(z.string()),
  /** Set when `action` is `overwrite`. */
  current: TournamentImportCurrentSchema.nullable(),
});
export type TournamentImportPreviewRow = z.infer<
  typeof TournamentImportPreviewRowSchema
>;

export const TournamentBulkImportPreviewResponseSchema = z.object({
  rows: z.array(TournamentImportPreviewRowSchema),
});
export type TournamentBulkImportPreviewResponse = z.infer<
  typeof TournamentBulkImportPreviewResponseSchema
>;

// What happened to one chosen row. `created` / `updated` mean the
// tournament, its form definition and its regulations were all written;
// `failed` means nothing of that tournament was, and `error` says why.
export const TournamentImportOutcomeSchema = z.enum([
  'created',
  'updated',
  'failed',
]);
export type TournamentImportOutcome = z.infer<
  typeof TournamentImportOutcomeSchema
>;

export const TournamentImportResultSchema = z.object({
  /** The row of the 大会一覧 sheet; null for a row no longer on it. */
  row: z.number().int().positive().nullable(),
  /** The 地域 / 種別 cells as written, so a failed row can be found. */
  regionName: z.string(),
  typeLabel: z.string(),
  outcome: TournamentImportOutcomeSchema,
  /** Set when the tournament was written. */
  tournamentId: z.string().uuid().nullable(),
  type: TournamentTypeSchema.nullable(),
  capacity: z.number().int().positive().nullable(),
  entryOpensAt: InstantSchema.nullable(),
  entryClosesAt: InstantSchema.nullable(),
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
