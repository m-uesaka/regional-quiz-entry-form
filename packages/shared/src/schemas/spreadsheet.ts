import {z} from 'zod';

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

/**
 * A spreadsheet to read, as staff paste it: its ID or its URL, trimmed, and
 * refused when blank. Every sheet import takes it this way (#301): read as
 * it was pasted, a URL was sent to Google as an ID and answered with a 404
 * ("シート取得失敗"), and a blank one cost a request for nothing.
 */
export const SpreadsheetIdInputSchema = z
  .string()
  .trim()
  .min(1, {message: 'スプレッドシートの ID または URL を入力してください'})
  .transform(spreadsheetIdFromInput);
