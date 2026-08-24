import {stringify as stringifyYaml} from 'yaml';
import {FormFieldDefYamlSchema} from '@regional-quiz/shared';

export interface SheetRow {
  label: string;
  type: string;
  required: string;
  options: string;
}

interface SheetValuesResponse {
  values?: string[][];
}

/**
 * Japanese dropdown labels (as filled in the spreadsheet's `type` column)
 * mapped to the internal `FormFieldDefYamlSchema` field type.
 */
const TYPE_LABELS: Record<string, 'checkbox' | 'radio' | 'textarea'> = {
  チェックボックス: 'checkbox',
  ラジオボタン: 'radio',
  自由記述: 'textarea',
};

/**
 * Reads a region staff-filled spreadsheet's field-definition rows via the
 * Google Sheets API v4 `values.get` endpoint. Uses an API key rather than a
 * service account, so the target spreadsheet must be shared as
 * publicly/link viewable. Row 1 is a header row, skipped by starting the
 * range at row 2.
 * @param spreadsheetId The Google Sheets spreadsheet ID.
 * @param apiKey The Google Sheets API key.
 */
export async function fetchSheetRows(
  spreadsheetId: string,
  apiKey: string,
): Promise<SheetRow[]> {
  const url =
    'https://sheets.googleapis.com/v4/spreadsheets/' +
    `${spreadsheetId}/values/A2:D?key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch sheet: ${res.status}`);
  }
  const {values} = (await res.json()) as SheetValuesResponse;
  return (values ?? []).map(([label, type, required, options]) => ({
    label,
    type,
    required,
    options,
  }));
}

/**
 * Converts raw spreadsheet rows into a Task 1-3 form-definition YAML
 * string, for preview purposes only (saving is a separate step via the
 * Task 2-2 upload API). Throws a `ZodError` if any row's data doesn't
 * match `FormFieldDefYamlSchema` (e.g. an unexpected `options` shape), or
 * a plain `Error` if a row's `type` isn't one of the dropdown's Japanese
 * labels. The field `key` isn't staff-entered; it's generated from each
 * row's position (`field_1`, `field_2`, ...) since a reliable key can't be
 * derived from a Japanese `label` (kanji readings aren't unambiguous).
 * @param tournamentSlug The tournament slug the form definition belongs to.
 * @param rows The raw spreadsheet rows to convert.
 */
export function sheetRowsToYaml(
  tournamentSlug: string,
  rows: SheetRow[],
): string {
  const fields = rows.map((row, index) => {
    const type = TYPE_LABELS[row.type];
    if (type === undefined) {
      throw new Error(`Unknown field type: ${row.type}`);
    }
    return FormFieldDefYamlSchema.parse({
      key: `field_${index + 1}`,
      label: row.label,
      type,
      required: row.required === '必須',
      options: row.options
        ? row.options.split(',').map(s => s.trim())
        : undefined,
    });
  });
  return stringifyYaml({tournamentSlug, fields});
}
