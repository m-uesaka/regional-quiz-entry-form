import {
  FormFieldDefYamlSchema,
  stringifyFormDefinitionYaml,
  type FormFieldDefYaml,
  type FormFieldType,
  type TournamentType,
} from '@regional-quiz/shared';
import {FORM_DEFINITION_RANGE, fetchSheetValues} from './google-sheets';

/**
 * One row of the form-definition tab. A cell the API left out is
 * `undefined`; the others are the text the sheet displays, untrimmed.
 */
export interface SheetRow {
  key: string | undefined;
  label: string | undefined;
  type: string | undefined;
  required: string | undefined;
  options: string | undefined;
}

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
 * A mistake on the form-definition tab, worded for staff and naming the
 * sheet row it is on.
 */
export class FormSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormSheetError';
  }
}

// What each column of the form tab is called in a message.
const FORM_COLUMN_NAMES: Record<string, string> = {
  key: 'A列(key)',
  label: 'B列(label)',
  type: 'C列(type)',
  required: 'D列(required)',
  options: 'E列(options)',
};

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
 * `formValues` of `fetchEntrySheet()` (#168).
 *
 * Unlike `cellText()`, a cell is neither trimmed nor turned into `''` when
 * absent: the schema refuses a missing label but takes an empty one, and a
 * label is stored as typed. (The type and required cells, which are only
 * matched, are trimmed where they are read.)
 * @param values The cells the API returned.
 */
export function sheetValuesToRows(values: unknown[][]): SheetRow[] {
  const text = (cell: unknown) =>
    cell === undefined || cell === null ? undefined : String(cell);
  return values.map(([key, label, type, required, options]) => ({
    key: text(key),
    label: text(label),
    type: text(type),
    required: text(required),
    options: text(options),
  }));
}

/**
 * Converts raw spreadsheet rows into a Task 1-3 form-definition YAML
 * string, for preview purposes only (saving is a separate step via the
 * Task 2-2 upload API). Reads the rows as `formRowsToFields()` does, so the
 * preview and the bulk import report the same mistakes in the same words.
 * @param tournamentSlug The tournament type slug the form definition belongs
 *     to. Embedded in the YAML and checked against the target tournament
 *     when the definition is saved, so it has to be one of the real
 *     tournament types rather than free text.
 * @param rows The raw spreadsheet rows to convert, from row 2.
 * @throws {FormSheetError} See `formRowsToFields()`.
 */
export function sheetRowsToYaml(
  tournamentSlug: TournamentType,
  rows: SheetRow[],
): string {
  return stringifyFormDefinitionYaml(tournamentSlug, formRowsToFields(rows));
}

/**
 * The fields the form tab defines, checked one row at a time so a mistake
 * is reported with its sheet row in Japanese rather than as a dump of Zod
 * issues.
 *
 * The field `key` is staff-entered (spreadsheet column A) rather than
 * derived from the row position or the Japanese `label`, so it stays
 * stable across row reordering/insertion — entries persist
 * `custom_field_values` keyed by it, so a key that changed on re-import
 * would silently reassociate existing answers with a different field.
 * @param rows The form tab's rows, from row 2.
 * @throws {FormSheetError} For the first row that is wrong, or for a key
 *     used twice.
 */
export function formRowsToFields(rows: SheetRow[]): FormFieldDefYaml[] {
  const fields = rows.map((row, index) =>
    sheetRowToField(row, `フォーム定義 ${index + 2}行目`),
  );
  const keys = fields.map(field => field.key);
  const repeated = keys.findIndex((key, index) => keys.indexOf(key) !== index);
  if (repeated !== -1) {
    const key = keys[repeated];
    const rowNumbers = keys.flatMap((other, index) =>
      other === key ? [`${index + 2}行目`] : [],
    );
    throw new FormSheetError(
      `フォーム定義 ${rowNumbers.join('と')}: A列(key)「${key}」が複数の行で使われています`,
    );
  }
  return fields;
}

/**
 * Converts one row of the form tab into a field.
 * @param row The row.
 * @param at Where the row is, to begin a message with.
 * @throws {FormSheetError} If the row is wrong.
 */
function sheetRowToField(row: SheetRow, at: string): FormFieldDefYaml {
  // The type and required cells are matched against the dropdown labels and
  // never stored, so stray spaces around a label don't stand in the way.
  const typeLabel = row.type?.trim() ?? '';
  if (typeLabel === '') {
    throw new FormSheetError(
      `${at}: C列(type)が空です。途中に空行がある場合は行を詰めてください`,
    );
  }
  // An own-property lookup, so a cell such as `constructor` is an unknown
  // label rather than whatever `Object.prototype` holds under that name.
  const type = Object.hasOwn(TYPE_LABELS, typeLabel)
    ? TYPE_LABELS[typeLabel]
    : undefined;
  if (type === undefined) {
    throw new FormSheetError(
      `${at}: C列(type)「${typeLabel}」は${Object.keys(TYPE_LABELS).join('・')}のいずれでもありません`,
    );
  }
  if (row.key === undefined || row.key.trim() === '') {
    throw new FormSheetError(`${at}: A列(key)が空です`);
  }
  const parsed = FormFieldDefYamlSchema.safeParse({
    key: row.key,
    label: row.label,
    type,
    required: row.required?.trim() === '必須',
    options: row.options ? parseOptions(row.options, at) : undefined,
  });
  if (parsed.success) {
    return parsed.data;
  }
  const column = parsed.error.issues[0]?.path[0];
  if (column === 'key') {
    throw new FormSheetError(
      `${at}: A列(key)「${row.key}」は小文字の英字で始まり、小文字の英数字と _ だけにしてください`,
    );
  }
  if (column === 'options') {
    throw new FormSheetError(
      `${at}: ラジオボタンには E列(options)に選択肢が1つ以上必要です`,
    );
  }
  const columnName =
    typeof column === 'string' && Object.hasOwn(FORM_COLUMN_NAMES, column)
      ? FORM_COLUMN_NAMES[column]
      : undefined;
  // An issue that names no column (a check across the whole row) is reported
  // against the row.
  throw new FormSheetError(
    columnName === undefined
      ? `${at}: 行の内容が正しくありません`
      : `${at}: ${columnName}の値が正しくありません`,
  );
}

/**
 * Parses a spreadsheet options cell (a comma-separated list) into a
 * deduplicated array of trimmed, non-empty option values. Blank entries
 * (e.g. from a trailing comma) are dropped rather than becoming an
 * unusable empty-string option, and duplicate values are rejected since
 * the frontend keys each rendered option by its value.
 * @param raw The raw comma-separated options cell content.
 * @param at Where the row is, to begin a message with.
 * @throws {FormSheetError} If a value is listed twice.
 */
function parseOptions(raw: string, at: string): string[] {
  const options = raw
    .split(',')
    .map(option => option.trim())
    .filter(option => option !== '');
  if (new Set(options).size !== options.length) {
    throw new FormSheetError(`${at}: E列(options)に同じ選択肢が複数あります`);
  }
  return options;
}
