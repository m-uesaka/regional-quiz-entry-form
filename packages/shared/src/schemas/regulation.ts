import {z} from 'zod';
import {SpreadsheetIdInputSchema} from './spreadsheet';
import {maxCodePoints, wellFormedText} from './text';

/**
 * The longest a regulation's label may be. A label is the condition itself
 * as entrants read it on the entry form (「開催地域に在住・在学・在勤の方」),
 * and some regions' conditions run long, so 400 (it started at 200 and
 * was raised to 300 first).
 */
export const REGULATION_LABEL_MAX_LENGTH = 400;

export const RegulationSchema = z.object({
  id: z.string().uuid(),
  tournamentId: z.string().uuid(),
  label: z.string(),
  priorityStartsAt: z.string().datetime({offset: true}).nullable(),
  priorityEndsAt: z.string().datetime({offset: true}).nullable(),
  // Taken off the choices once the marked phases are over (#243); see
  // `selectableRegulations()`.
  closesWithPriority: z.boolean(),
  displayOrder: z.number().int(),
});
export type Regulation = z.infer<typeof RegulationSchema>;

/**
 * One entry of a regulation save request. An element carrying an `id`
 * updates that existing row; one without adds a new regulation.
 *
 * `displayOrder` is deliberately absent: the array order is the display
 * order, so a client can reorder regulations by reordering the array
 * without having to renumber anything itself.
 */
export const RegulationUpsertSchema = z
  .object({
    id: z.string().uuid().optional(),
    label: wellFormedText(
      maxCodePoints(
        // Trimmed as the regulation sheet's cells are (`cellText()`), so a
        // label typed in the form can't be blank but for spaces (#300).
        z
          .string()
          .trim()
          .min(1, {message: 'レギュレーション名を入力してください'}),
        REGULATION_LABEL_MAX_LENGTH,
        `レギュレーション名は${REGULATION_LABEL_MAX_LENGTH}文字以内で入力してください`,
      ),
      'レギュレーション名',
    ),
    // Omitting either field means "no priority window", so a client that
    // never uses one doesn't have to send explicit nulls.
    priorityStartsAt: z
      .string()
      .datetime({offset: true})
      .nullable()
      .default(null),
    priorityEndsAt: z
      .string()
      .datetime({offset: true})
      .nullable()
      .default(null),
    // Omitted means "as stored": `sync_regulations()` keeps an existing
    // row's value and starts a new row at false. A blank spreadsheet cell
    // and a client older than this field both omit it, and neither may
    // undo the value 0042 worked out for a running tournament.
    closesWithPriority: z.boolean().optional(),
  })
  .refine(r => (r.priorityStartsAt === null) === (r.priorityEndsAt === null), {
    message: '優先期間は開始と終了の両方を指定してください',
    path: ['priorityEndsAt'],
  })
  .refine(
    r =>
      r.priorityStartsAt === null ||
      Date.parse(r.priorityStartsAt) < Date.parse(r.priorityEndsAt!),
    {
      message: '優先期間の終了は開始より後にしてください',
      path: ['priorityEndsAt'],
    },
  )
  .refine(r => r.priorityStartsAt !== null || r.closesWithPriority !== true, {
    message: '優先期間の終了後に選択肢から外すには、優先期間を指定してください',
    path: ['closesWithPriority'],
  });
export type RegulationUpsert = z.infer<typeof RegulationUpsertSchema>;

/**
 * Why a save is refused when every regulation is marked to close: once the
 * marked phases are over, `selectableRegulations()` would offer nothing and
 * every submission would be refused while the tournament still reads as
 * open. Shared by the schema below and the backend, which reports the same
 * refusal from `sync_regulations()` (`P0009`) for a save whose omitted
 * values keep stored `true`s.
 */
export const NO_LASTING_REGULATION_MESSAGE =
  '優先期間の終了後も選択肢に残るレギュレーションが1つ以上必要です';

/**
 * Request body of the regulation save API: the tournament's regulations in
 * full, as the whole set should look afterwards.
 *
 * At least one regulation is required — an entry has to name one, so a
 * tournament with none can't be entered at all. For the same reason at least
 * one must not be marked to close (`NO_LASTING_REGULATION_MESSAGE`). This
 * only sees the values sent: an omitted one keeps what is stored, which
 * `sync_regulations()` checks.
 */
export const RegulationSyncInputSchema = z.object({
  regulations: z
    .array(RegulationUpsertSchema)
    .min(1)
    .refine(
      regulations => regulations.some(r => r.closesWithPriority !== true),
      {message: NO_LASTING_REGULATION_MESSAGE},
    )
    // Two elements naming the same existing row would make the sync
    // ambiguous (and the upsert behind it fails outright when a single
    // statement touches one row twice), so they're rejected here instead.
    .refine(
      regulations => {
        const ids = regulations
          .map(r => r.id)
          .filter((id): id is string => id !== undefined);
        return new Set(ids).size === ids.length;
      },
      {message: 'レギュレーションの id が重複しています'},
    ),
});
export type RegulationSyncInput = z.infer<typeof RegulationSyncInputSchema>;

/**
 * The title of the spreadsheet tab region staff list their regulations on.
 * The import reads the tab by this name, so it has to match exactly; the
 * form-definition tab, by contrast, is simply whichever tab comes first.
 */
export const REGULATION_SHEET_NAME = 'レギュレーション';

/**
 * Request body for the regulation sheet-import preview API: the spreadsheet
 * whose regulation tab is to be read. Shared so the frontend and backend
 * validate the same shape.
 */
export const RegulationSheetImportRequestSchema = z.object({
  spreadsheetId: SpreadsheetIdInputSchema,
});
export type RegulationSheetImportRequest = z.infer<
  typeof RegulationSheetImportRequestSchema
>;
