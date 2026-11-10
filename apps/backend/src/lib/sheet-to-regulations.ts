import {
  REGULATION_SHEET_NAME,
  RegulationSyncInputSchema,
  type RegulationUpsert,
} from '@regional-quiz/shared';
import {
  cellText,
  fetchSheetValues,
  isBlankCell,
  SheetFetchError,
} from './google-sheets';
import {parseSheetDatetime} from './sheet-datetime';

/**
 * A mistake on the regulation tab, worded for staff and naming the sheet row
 * it is on where there is one.
 */
export class RegulationSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegulationSheetError';
  }
}

// What the 優先期間後 column may say. Anything else is refused rather than
// read as one of them: a typo here changes who may enter.
const AFTER_PRIORITY_CELLS: ReadonlyMap<string, boolean> = new Map([
  ['外す', true],
  ['残す', false],
]);

/**
 * Reads the regulation rows of a region staff-filled spreadsheet: columns
 * A–D of the tab named `REGULATION_SHEET_NAME`, from row 2 down (row 1 is a
 * header).
 *
 * The cells are requested unformatted with dates as serial numbers, so a
 * date-time cell arrives as a number whatever locale or display format the
 * spreadsheet uses — the formatted string would differ from one sheet to
 * the next.
 *
 * @param spreadsheetId The Google Sheets spreadsheet ID.
 * @param apiKey The Google Sheets API key.
 * @throws {SheetFetchError} If the request fails. Google answers a range
 *     naming a tab that doesn't exist with a 400, which is reported with a
 *     message saying so.
 */
export async function fetchRegulationSheetValues(
  spreadsheetId: string,
  apiKey: string,
): Promise<unknown[][]> {
  try {
    return await fetchSheetValues(
      spreadsheetId,
      `'${REGULATION_SHEET_NAME}'!A2:D`,
      apiKey,
      {
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER',
      },
    );
  } catch (e: unknown) {
    if (e instanceof SheetFetchError && e.status === 400) {
      throw new SheetFetchError(
        `「${REGULATION_SHEET_NAME}」シートを読み取れません。` +
          'シート名とスプレッドシートIDを確認してください',
        e.status,
      );
    }
    throw e;
  }
}

/**
 * Converts the regulation tab's rows into the regulations a save request
 * carries, in sheet order (which becomes the display order).
 *
 * Rows with nothing in any of the four columns are skipped, so a gap left
 * between regulations is harmless. The priority window is read as JST
 * wall-clock time whatever the spreadsheet's own timezone setting is.
 *
 * A blank 優先期間後 cell, which is every row of a sheet from before the
 * column existed, leaves `closesWithPriority` out, so saving keeps the stored
 * value rather than clearing it (#243).
 *
 * None of the returned regulations carries an `id`: the sheet knows nothing
 * of the stored rows, so pairing them up is left to the caller.
 *
 * @param rows The rows from `fetchRegulationSheetValues`.
 * @throws {Error} With a staff-facing Japanese message naming the sheet row
 *     when a row can't be read, a label is repeated, or the set is refused
 *     by `RegulationSyncInputSchema` (a half-filled or reversed priority
 *     window, no regulations at all).
 */
export function sheetValuesToRegulations(
  rows: unknown[][],
): RegulationUpsert[] {
  const regulations: Array<{
    label: string;
    priorityStartsAt: string | null;
    priorityEndsAt: string | null;
    closesWithPriority?: boolean;
  }> = [];
  // The sheet row each kept regulation came from, for error messages.
  const rowNumbers: number[] = [];
  const seenLabels = new Set<string>();

  rows.forEach((row, index) => {
    // The range starts at row 2.
    const rowNumber = index + 2;
    const [labelCell, startsAtCell, endsAtCell, afterPriorityCell] = row;
    if (
      [labelCell, startsAtCell, endsAtCell, afterPriorityCell].every(
        isBlankCell,
      )
    ) {
      return;
    }
    const label = cellText(labelCell);
    if (label === '') {
      throw new RegulationSheetError(
        `${rowNumber}行目: レギュレーション名が空です`,
      );
    }
    if (seenLabels.has(label)) {
      throw new RegulationSheetError(
        `${rowNumber}行目: レギュレーション名が重複しています: ${label}`,
      );
    }
    seenLabels.add(label);
    regulations.push({
      label,
      priorityStartsAt: parseRegulationDatetime(
        startsAtCell,
        rowNumber,
        '優先期間の開始',
      ),
      priorityEndsAt: parseRegulationDatetime(
        endsAtCell,
        rowNumber,
        '優先期間の終了',
      ),
      closesWithPriority: parseAfterPriorityCell(afterPriorityCell, rowNumber),
    });
    rowNumbers.push(rowNumber);
  });

  if (regulations.length === 0) {
    throw new RegulationSheetError(
      `「${REGULATION_SHEET_NAME}」シートにレギュレーションが1件もありません`,
    );
  }

  const parsed = RegulationSyncInputSchema.safeParse({regulations});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Issues on a single regulation are pathed `['regulations', i, ...]`.
    const index = issue?.path[1];
    const prefix =
      typeof index === 'number' && rowNumbers[index] !== undefined
        ? `${rowNumbers[index]}行目: `
        : '';
    throw new RegulationSheetError(
      `${prefix}${issue?.message ?? '内容を確認してください'}`,
    );
  }
  return parsed.data.regulations;
}

/**
 * Reads one 優先期間後 cell.
 * @param cell The unformatted cell.
 * @param rowNumber The sheet row, for the error message.
 * @return Whether the regulation closes with its priority window, or
 *     undefined for a blank cell.
 */
function parseAfterPriorityCell(
  cell: unknown,
  rowNumber: number,
): boolean | undefined {
  if (isBlankCell(cell)) {
    return undefined;
  }
  const closes =
    typeof cell === 'string'
      ? AFTER_PRIORITY_CELLS.get(cell.trim())
      : undefined;
  if (closes === undefined) {
    throw new RegulationSheetError(
      `${rowNumber}行目: 優先期間後の扱いは「外す」か「残す」で指定してください: ` +
        String(cell),
    );
  }
  return closes;
}

/**
 * Reads one priority-window cell as an instant.
 * @param cell The unformatted cell: a date serial for a date-time cell, a
 *     string for one typed as text.
 * @param rowNumber The sheet row, for the error message.
 * @param columnLabel The column's name, for the error message.
 * @return The instant as an ISO 8601 string, or null for a blank cell.
 */
function parseRegulationDatetime(
  cell: unknown,
  rowNumber: number,
  columnLabel: string,
): string | null {
  if (isBlankCell(cell)) {
    return null;
  }
  // A bare date is read as midnight: a priority window may open or close at
  // the turn of a day.
  const instant = parseSheetDatetime(cell, {requireTime: false});
  if (instant === null) {
    throw new RegulationSheetError(
      `${rowNumber}行目: ${columnLabel}を日時として読み取れません: ` +
        `${String(cell)}(例: 2026-08-01 10:00)`,
    );
  }
  return instant;
}
