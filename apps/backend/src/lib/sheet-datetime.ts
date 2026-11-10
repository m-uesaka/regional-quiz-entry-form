// Reads a date-time cell of a staff-filled spreadsheet as a Japan-time
// instant. Shared by the 大会一覧 sheet and the regulation tab, which are both
// requested unformatted with dates as serial numbers
// (`valueRenderOption=UNFORMATTED_VALUE`, `dateTimeRenderOption=
// SERIAL_NUMBER`), so a date-time cell arrives as a number whatever locale
// or display format the spreadsheet uses.
import {isBlankCell} from './google-sheets';
import {formatJstDateTime, JST_OFFSET_MS} from './jst';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A Sheets date serial counts days from 1899-12-30; this is the serial of
// the Unix epoch.
const UNIX_EPOCH_SERIAL = 25569;

// The serial of 2000-01-01. A bare number below it is far likelier to be a
// stray figure typed into a date column (`2026`, say, is a day in 1905)
// than a date anyone meant.
const MIN_PLAUSIBLE_SERIAL = 36526;

// A date-time typed as text: `2026-08-01 10:00`, `2026/8/1 10:00:30`, or --
// where the time is optional -- a bare date, which is read as midnight.
const DATETIME_TEXT_PATTERN =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/** How strictly `parseSheetDatetime()` reads a cell. */
export interface SheetDatetimeOptions {
  /**
   * Whether a date typed as text must carry a time of day. A bare date
   * would leave it open whether something ends at the start or the end of
   * that day. Does not apply to a serial number, which always carries a
   * time (midnight for a date-only cell, indistinguishably from a 0:00
   * date-time).
   */
  requireTime: boolean;
}

/**
 * Reads a date-time cell as a Japan-time instant.
 * @param cell The unformatted cell: a date serial for a date-time cell, a
 *     string for one typed as text. The caller handles blank cells.
 * @param options How strictly to read it.
 * @return The instant as an ISO 8601 string, or `null` if the cell isn't a
 *     date-time (or names a date that doesn't exist, `2026-02-30`).
 */
export function parseSheetDatetime(
  cell: unknown,
  options: SheetDatetimeOptions,
): string | null {
  const wallClockMs =
    typeof cell === 'number'
      ? serialToWallClockMs(cell)
      : typeof cell === 'string'
        ? textToWallClockMs(cell.trim(), options.requireTime)
        : undefined;
  return wallClockMs === undefined
    ? null
    : new Date(wallClockMs - JST_OFFSET_MS).toISOString();
}

/**
 * Writes a date-time cell the way staff would recognise it, for an error
 * message.
 * @param cell The unformatted cell.
 * @return A serial as `YYYY-MM-DD HH:mm` (when it is a plausible date),
 *     anything else as its text.
 */
export function describeSheetDatetime(cell: unknown): string {
  if (isBlankCell(cell)) {
    return '';
  }
  if (typeof cell === 'number') {
    const iso = parseSheetDatetime(cell, {requireTime: false});
    if (iso !== null) {
      return formatJstDateTime(iso);
    }
  }
  return String(cell).trim();
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
 * @param requireTime Whether a bare date is refused.
 * @return The wall-clock time, or undefined when the text isn't a date-time
 *     or names a date that doesn't exist (`2026-02-30`).
 */
function textToWallClockMs(
  text: string,
  requireTime: boolean,
): number | undefined {
  const match = DATETIME_TEXT_PATTERN.exec(text);
  if (!match || (requireTime && match[4] === undefined)) {
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
