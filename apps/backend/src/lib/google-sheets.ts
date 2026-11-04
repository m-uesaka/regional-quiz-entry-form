// The Google Sheets API v4 client the sheet imports share: reading a range
// or an entry-form spreadsheet's two tabs, and reading a cell as text. What
// the cells mean is left to the converters (`sheet-to-form-definition.ts`,
// `sheet-to-regulations.ts`, `tournament-bulk-import.ts`).

interface SheetValuesResponse {
  values?: unknown[][];
}

/**
 * The range of the first tab the field-definition rows are read from: five
 * columns, from row 2 down (row 1 is a header).
 */
export const FORM_DEFINITION_RANGE = 'A2:E';

/**
 * Thrown when the Google Sheets API request itself fails to produce sheet
 * data — either the network request never completed, or Google returned
 * a non-2xx response. Carries the HTTP status code when one is available
 * (absent for a network-level failure), so callers can distinguish a
 * caller-caused error (e.g. a bad spreadsheet ID or an inaccessible
 * sheet, typically HTTP 400/403/404) from an upstream Google outage or
 * rate limit (HTTP 429/5xx, or no response at all).
 */
export class SheetFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SheetFetchError';
  }
}

/**
 * Reads one range of a spreadsheet via the Google Sheets API v4
 * `values.get` endpoint. Uses an API key rather than a service account, so
 * the target spreadsheet must be shared as publicly/link viewable. Throws
 * `SheetFetchError` if the request fails, whether from a network error or a
 * non-2xx Google response.
 * @param spreadsheetId The Google Sheets spreadsheet ID.
 * @param range The A1 range to read. A range naming no tab reads the first
 *     one.
 * @param apiKey The Google Sheets API key.
 * @param query Extra `values.get` query parameters (e.g. the render
 *     options).
 * @return The rows Google returned. Trailing empty rows and cells are
 *     omitted by the API, and a row inside the data that is empty comes
 *     back as an empty array.
 */
export async function fetchSheetValues(
  spreadsheetId: string,
  range: string,
  apiKey: string,
  query: Record<string, string> = {},
): Promise<unknown[][]> {
  const params = new URLSearchParams({...query, key: apiKey});
  const url =
    'https://sheets.googleapis.com/v4/spreadsheets/' +
    `${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${params}`;
  const res = await fetchSheets(url);
  const {values} = (await res.json()) as SheetValuesResponse;
  return values ?? [];
}

/** One cell of a `spreadsheets.get` grid, as the field mask below asks. */
interface GridCell {
  formattedValue?: string;
  effectiveValue?: {
    numberValue?: number;
    stringValue?: string;
    boolValue?: boolean;
  };
}

interface SpreadsheetGridResponse {
  sheets?: Array<{
    properties?: {title?: string};
    data?: Array<{rowData?: Array<{values?: GridCell[]}>}>;
  }>;
}

/** An entry-form spreadsheet's two tabs, as `fetchEntrySheet()` reads them. */
export interface EntrySheetValues {
  /**
   * The form-definition rows, every cell as the sheet displays it, or
   * `undefined` for a cell with nothing displayed.
   */
  formValues: Array<Array<string | undefined>>;
  /**
   * The regulation rows, every cell unformatted (a date-time as its serial
   * number).
   */
  regulationValues: unknown[][];
}

/**
 * Reads both tabs of a region staff-filled entry-form spreadsheet in one
 * request, so reading many spreadsheets in one go (the bulk tournament
 * import, #168) costs one request per spreadsheet against the Sheets API's
 * per-minute quota.
 *
 * The two tabs want different renderings, which is why this goes through
 * `spreadsheets.get` rather than `values:batchGet` (whose render option
 * applies to every range): the form tab is read as displayed -- an option
 * typed as `10%` or `1,000` must stay that text -- while the regulation tab
 * is read unformatted, so a date-time cell arrives as a serial whatever its
 * display format. The grid carries both per cell, and each tab comes back
 * as the single-tab reads of the same range would return it.
 *
 * Same authentication and failure modes as `fetchSheetValues()`; a missing
 * regulation tab fails the whole request with a 400.
 * @param spreadsheetId The Google Sheets spreadsheet ID.
 * @param apiKey The Google Sheets API key.
 * @param regulationSheetName The title of the regulation tab.
 */
export async function fetchEntrySheet(
  spreadsheetId: string,
  apiKey: string,
  regulationSheetName: string,
): Promise<EntrySheetValues> {
  const params = new URLSearchParams({
    key: apiKey,
    includeGridData: 'true',
    fields:
      'sheets(properties.title,' +
      'data.rowData.values(formattedValue,effectiveValue))',
  });
  params.append('ranges', FORM_DEFINITION_RANGE);
  params.append('ranges', `'${regulationSheetName}'!A2:D`);
  const url =
    'https://sheets.googleapis.com/v4/spreadsheets/' +
    `${encodeURIComponent(spreadsheetId)}?${params}`;
  const res = await fetchSheets(url);
  const {sheets = []} = (await res.json()) as SpreadsheetGridResponse;
  // The response lists the tabs the ranges touch, in the spreadsheet's own
  // order rather than the ranges', so they are told apart by title: the
  // form range names no tab and so reads the first one, which is never the
  // regulation tab in a sheet laid out as documented.
  const regulationSheet = sheets.find(
    sheet => sheet.properties?.title === regulationSheetName,
  );
  const formSheet =
    sheets.find(sheet => sheet !== regulationSheet) ?? regulationSheet;
  const rowsOf = <T>(
    sheet: (typeof sheets)[number] | undefined,
    read: (cell: GridCell) => T,
  ): T[][] =>
    trimTrailingBlankRows(
      (sheet?.data?.[0]?.rowData ?? []).map(row =>
        (row.values ?? []).map(read),
      ),
    );
  return {
    formValues: rowsOf(formSheet, cell => cell.formattedValue),
    regulationValues: rowsOf(regulationSheet, cell => {
      const value = cell.effectiveValue;
      return value?.numberValue ?? value?.stringValue ?? value?.boolValue;
    }),
  };
}

/**
 * A cell as trimmed text, empty for a cell the API left out.
 * @param cell The cell as the API returned it: a string, a number, a
 *     boolean, or `undefined` for one it left out.
 */
export function cellText(cell: unknown): string {
  return cell === undefined || cell === null ? '' : String(cell).trim();
}

/**
 * Whether a cell holds nothing but whitespace, or was left out. A number or
 * a boolean is never blank.
 * @param cell The cell as the API returned it.
 */
export function isBlankCell(cell: unknown): boolean {
  return cellText(cell) === '';
}

/**
 * GETs a Sheets API URL.
 * @throws {SheetFetchError} If the request never completes or Google
 *     answers with a non-2xx status.
 */
async function fetchSheets(url: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e: unknown) {
    throw new SheetFetchError(
      `Failed to reach Google Sheets: ${e instanceof Error ? e.message : 'network error'}`,
    );
  }
  if (!res.ok) {
    throw new SheetFetchError(
      `Failed to fetch sheet: ${res.status}`,
      res.status,
    );
  }
  return res;
}

/**
 * Drops the empty rows (and each row's empty trailing cells) at the end of
 * a grid, which `values.get` leaves out but a `spreadsheets.get` grid may
 * carry, so both read the same.
 */
function trimTrailingBlankRows<T>(rows: T[][]): T[][] {
  const trimmed = rows.map(row => {
    let end = row.length;
    while (end > 0 && (row[end - 1] === undefined || row[end - 1] === '')) {
      end--;
    }
    return row.slice(0, end);
  });
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1].length === 0) end--;
  return trimmed.slice(0, end);
}
