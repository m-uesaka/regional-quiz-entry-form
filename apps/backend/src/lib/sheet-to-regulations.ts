import {
  REGULATION_SHEET_NAME,
  RegulationSyncInputSchema,
  type RegulationUpsert,
} from '@regional-quiz/shared';
import {JST_OFFSET_MS} from './jst';
import {fetchSheetValues, SheetFetchError} from './sheet-to-form-definition';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A Sheets date serial counts days from 1899-12-30; this is the serial of
// the Unix epoch.
const UNIX_EPOCH_SERIAL = 25569;

// The serial of 2000-01-01. A bare number below it is far likelier to be a
// stray figure typed into a date column (`2026`, say, is a day in 1905)
// than a priority window anyone meant.
const MIN_PLAUSIBLE_SERIAL = 36526;

// A date-time typed as text: `2026-08-01 10:00`, `2026/8/1 10:00:30`, or a
// bare date, which is read as midnight.
const DATETIME_TEXT_PATTERN =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Reads the regulation rows of a region staff-filled spreadsheet: columns
 * A–C of the tab named `REGULATION_SHEET_NAME`, from row 2 down (row 1 is a
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
      `'${REGULATION_SHEET_NAME}'!A2:C`,
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
 * Rows with nothing in any of the three columns are skipped, so a gap left
 * between regulations is harmless. The priority window is read as JST
 * wall-clock time whatever the spreadsheet's own timezone setting is.
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
  }> = [];
  // The sheet row each kept regulation came from, for error messages.
  const rowNumbers: number[] = [];
  const seenLabels = new Set<string>();

  rows.forEach((row, index) => {
    // The range starts at row 2.
    const rowNumber = index + 2;
    const [labelCell, startsAtCell, endsAtCell] = row;
    if ([labelCell, startsAtCell, endsAtCell].every(isBlankCell)) {
      return;
    }
    const label = isBlankCell(labelCell) ? '' : String(labelCell).trim();
    if (label === '') {
      throw new Error(`${rowNumber}行目: レギュレーション名が空です`);
    }
    if (seenLabels.has(label)) {
      throw new Error(
        `${rowNumber}行目: レギュレーション名が重複しています: ${label}`,
      );
    }
    seenLabels.add(label);
    regulations.push({
      label,
      priorityStartsAt: parseSheetDatetime(
        startsAtCell,
        rowNumber,
        '優先期間の開始',
      ),
      priorityEndsAt: parseSheetDatetime(
        endsAtCell,
        rowNumber,
        '優先期間の終了',
      ),
    });
    rowNumbers.push(rowNumber);
  });

  if (regulations.length === 0) {
    throw new Error(
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
    throw new Error(`${prefix}${issue?.message ?? '内容を確認してください'}`);
  }
  return parsed.data.regulations;
}

function isBlankCell(cell: unknown): boolean {
  return (
    cell === undefined ||
    cell === null ||
    (typeof cell === 'string' && cell.trim() === '')
  );
}

/**
 * Reads one priority-window cell as an instant.
 * @param cell The unformatted cell: a date serial for a date-time cell, a
 *     string for one typed as text.
 * @param rowNumber The sheet row, for the error message.
 * @param columnLabel The column's name, for the error message.
 * @return The instant as an ISO 8601 string, or null for a blank cell.
 */
function parseSheetDatetime(
  cell: unknown,
  rowNumber: number,
  columnLabel: string,
): string | null {
  if (isBlankCell(cell)) {
    return null;
  }
  const wallClockMs =
    typeof cell === 'number'
      ? serialToWallClockMs(cell)
      : typeof cell === 'string'
        ? textToWallClockMs(cell.trim())
        : undefined;
  if (wallClockMs === undefined) {
    throw new Error(
      `${rowNumber}行目: ${columnLabel}を日時として読み取れません: ` +
        `${String(cell)}(例: 2026-08-01 10:00)`,
    );
  }
  return new Date(wallClockMs - JST_OFFSET_MS).toISOString();
}

/**
 * Converts a Sheets date serial into the wall-clock time it shows, as
 * milliseconds on a UTC scale (i.e. before any timezone is applied).
 * @param serial Days since 1899-12-30, with the time of day as a fraction.
 * @return The wall-clock time, or undefined for a number that is no
 *     plausible date.
 */
function serialToWallClockMs(serial: number): number | undefined {
  if (!Number.isFinite(serial) || serial < MIN_PLAUSIBLE_SERIAL) {
    return undefined;
  }
  // A time of day is a binary fraction of a day, so the product lands a
  // hair off the second it stands for; rounding to the second undoes that.
  const seconds = Math.round(
    ((serial - UNIX_EPOCH_SERIAL) * MS_PER_DAY) / 1000,
  );
  const ms = seconds * 1000;
  return Number.isNaN(new Date(ms).getTime()) ? undefined : ms;
}

/**
 * Parses a date-time typed as text into wall-clock milliseconds on a UTC
 * scale.
 * @param text The trimmed cell text.
 * @return The wall-clock time, or undefined when the text isn't a date-time
 *     or names a date that doesn't exist (`2026-02-30`).
 */
function textToWallClockMs(text: string): number | undefined {
  const match = DATETIME_TEXT_PATTERN.exec(text);
  if (!match) {
    return undefined;
  }
  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map(part => (part === undefined ? 0 : Number(part)));
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(ms);
  // `Date.UTC` rolls an out-of-range field over into the next unit instead
  // of refusing it, so the result is checked against what was typed.
  const isSameAsTyped =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
  return isSameAsTyped ? ms : undefined;
}
