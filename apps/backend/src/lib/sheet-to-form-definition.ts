import {
  FormFieldDefYamlSchema,
  stringifyFormDefinitionYaml,
  type FormFieldType,
  type TournamentType,
} from '@regional-quiz/shared';

export interface SheetRow {
  key: string;
  label: string;
  type: string;
  required: string;
  options: string;
}

interface SheetValuesResponse {
  values?: unknown[][];
}

/**
 * The range of the first tab the field-definition rows are read from: five
 * columns, from row 2 down (row 1 is a header).
 */
export const FORM_DEFINITION_RANGE = 'A2:E';

/**
 * Japanese dropdown labels (as filled in the spreadsheet's `type` column)
 * mapped to the internal `FormFieldDefYamlSchema` field type.
 */
export const TYPE_LABELS: Record<string, FormFieldType> = {
  チェックボックス: 'checkbox',
  ラジオボタン: 'radio',
  自由記述: 'textarea',
  '自由記述（一行）': 'textfield',
};

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
  const {values} = (await res.json()) as SheetValuesResponse;
  return values ?? [];
}

/**
 * Thrown by `sheetRowsToYaml()` for a row whose `type` cell isn't one of
 * the dropdown's labels (`TYPE_LABELS`), including a blank one.
 */
export class UnknownFieldTypeError extends Error {
  constructor(readonly label: string | undefined) {
    super(`Unknown field type: ${label}`);
    this.name = 'UnknownFieldTypeError';
  }
}

/** Thrown by `sheetRowsToYaml()` for an options cell listing a value twice. */
export class DuplicateOptionError extends Error {
  constructor(readonly raw: string) {
    super(`Duplicate option values: ${raw}`);
    this.name = 'DuplicateOptionError';
  }
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
  /** The form-definition rows, every cell as the sheet displays it. */
  formValues: string[][];
  /**
   * The regulation rows, every cell unformatted (a date-time as its serial
   * number), as `sheetValuesToRegulations()` reads them.
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
 * applies to every range): the form tab is read as displayed, exactly as
 * `fetchSheetRows()` reads it -- an option typed as `10%` or `1,000` must
 * stay that text -- while the regulation tab is read unformatted, as
 * `fetchRegulationSheetValues()` reads it, so a date-time cell arrives as a
 * serial whatever its display format. The grid carries both per cell.
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
  params.append('ranges', `'${regulationSheetName}'!A2:C`);
  const url =
    'https://sheets.googleapis.com/v4/spreadsheets/' +
    `${encodeURIComponent(spreadsheetId)}?${params}`;
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
  const rowsOf = (
    sheet: (typeof sheets)[number] | undefined,
    read: (cell: GridCell) => unknown,
  ) =>
    trimTrailingBlankRows(
      (sheet?.data?.[0]?.rowData ?? []).map(row =>
        (row.values ?? []).map(read),
      ),
    );
  return {
    formValues: rowsOf(formSheet, cell => cell.formattedValue) as string[][],
    regulationValues: rowsOf(regulationSheet, cell => {
      const value = cell.effectiveValue;
      return value?.numberValue ?? value?.stringValue ?? value?.boolValue;
    }),
  };
}

/**
 * Drops the empty rows (and each row's empty trailing cells) at the end of
 * a grid, which `values.get` leaves out but a `spreadsheets.get` grid may
 * carry, so both read the same.
 */
function trimTrailingBlankRows(rows: unknown[][]): unknown[][] {
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

/**
 * Reads a region staff-filled spreadsheet's field-definition rows from its
 * first tab. Row 1 is a header row, skipped by starting the range at row 2.
 * Throws `SheetFetchError` if the request fails (see `fetchSheetValues`).
 * @param spreadsheetId The Google Sheets spreadsheet ID.
 * @param apiKey The Google Sheets API key.
 */
export async function fetchSheetRows(
  spreadsheetId: string,
  apiKey: string,
): Promise<SheetRow[]> {
  // Read with the default render options, under which every cell comes back
  // as the string the sheet displays.
  return sheetValuesToRows(
    await fetchSheetValues(spreadsheetId, FORM_DEFINITION_RANGE, apiKey),
  );
}

/**
 * Turns the cells of `FORM_DEFINITION_RANGE`, as displayed, into rows -- the
 * cells `fetchSheetValues()` returns with its default rendering, or the
 * `formValues` of `fetchEntrySheet()` (#168). A cell the API left out
 * (trailing and empty) stays `undefined`.
 * @param values The cells the API returned.
 */
export function sheetValuesToRows(values: unknown[][]): SheetRow[] {
  const text = (cell: unknown) =>
    (cell === undefined || cell === null ? undefined : String(cell)) as string;
  return values.map(([key, label, type, required, options]) => ({
    key: text(key),
    label: text(label),
    type: text(type),
    required: text(required),
    options: text(options),
  }));
}

/**
 * Parses a spreadsheet options cell (a comma-separated list) into a
 * deduplicated array of trimmed, non-empty option values. Blank entries
 * (e.g. from a trailing comma) are dropped rather than becoming an
 * unusable empty-string option, and duplicate values are rejected since
 * the frontend keys each rendered option by its value.
 * @param raw The raw comma-separated options cell content.
 */
function parseOptions(raw: string): string[] {
  const options = raw
    .split(',')
    .map(option => option.trim())
    .filter(option => option !== '');
  if (new Set(options).size !== options.length) {
    throw new DuplicateOptionError(raw);
  }
  return options;
}

/**
 * Converts raw spreadsheet rows into a Task 1-3 form-definition YAML
 * string, for preview purposes only (saving is a separate step via the
 * Task 2-2 upload API). Throws a `ZodError` if any row's data doesn't
 * match `FormFieldDefYamlSchema` (e.g. an unexpected `options` shape or an
 * invalid `key`), or a plain `Error` if a row's `type` isn't one of the
 * dropdown's Japanese labels, or its `options` contain duplicate values.
 * The field `key` is staff-entered (spreadsheet column A) rather than
 * derived from the row position or the Japanese `label`, so it stays
 * stable across row reordering/insertion — entries persist
 * `custom_field_values` keyed by it, so a key that changed on re-import
 * would silently reassociate existing answers with a different field.
 * @param tournamentSlug The tournament type slug the form definition belongs
 *     to. Embedded in the YAML and checked against the target tournament
 *     when the definition is saved, so it has to be one of the real
 *     tournament types rather than free text.
 * @param rows The raw spreadsheet rows to convert.
 */
export function sheetRowsToYaml(
  tournamentSlug: TournamentType,
  rows: SheetRow[],
): string {
  const fields = rows.map(row => {
    const type = TYPE_LABELS[row.type];
    if (type === undefined) {
      throw new UnknownFieldTypeError(row.type);
    }
    return FormFieldDefYamlSchema.parse({
      key: row.key,
      label: row.label,
      type,
      required: row.required === '必須',
      options: row.options ? parseOptions(row.options) : undefined,
    });
  });
  return stringifyFormDefinitionYaml(tournamentSlug, fields);
}
