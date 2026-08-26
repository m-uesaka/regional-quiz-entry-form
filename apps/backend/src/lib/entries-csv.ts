import {
  BOOLEAN_CHECKBOX_LABELS,
  isBooleanCheckbox,
  type CustomFieldValues,
  type FormFieldDef,
} from '@regional-quiz/shared';

/** The columns every export starts with, before the custom fields. */
const FIXED_HEADERS = ['氏名', 'ふりがな', '掲載名', 'ステータス'];

/** Separator between the selected options of a multi-select checkbox. */
const MULTI_VALUE_SEPARATOR = ';';

/**
 * Leading characters that make a spreadsheet treat a cell as a formula.
 * Tab and CR are included because they can be skipped over before the
 * formula character is reached.
 */
const FORMULA_LEAD_PATTERN = /^[=+\-@\t\r]/;

/**
 * A single entry as rendered into the CSV. `status` is already the
 * human-readable label, not the stored `EntryStatus` value.
 */
export interface EntriesCsvRow {
  name: string;
  furigana: string;
  displayName: string;
  status: string;
  customFieldValues: CustomFieldValues;
}

/**
 * Renders staff-facing entry rows as a CSV document.
 *
 * The tournament's custom form fields become extra columns headed by their
 * `label`, in the order `fieldDefs` is given (the caller is expected to pass
 * them in `display_order`), so a field renamed after entries were submitted
 * exports under its current label. Answers are looked up by `fieldKey`, and
 * a field a given entry has no answer for exports as an empty cell.
 *
 * Rows are separated by CRLF and there is no trailing newline, per RFC 4180,
 * and cells a spreadsheet would read as formulas are neutralized.
 * @param fieldDefs The tournament's custom form field definitions.
 * @param entries The entries to export, in the order they should appear.
 */
export function buildEntriesCsv(
  fieldDefs: FormFieldDef[],
  entries: EntriesCsvRow[],
): string {
  const headers = [...FIXED_HEADERS, ...fieldDefs.map(f => f.label)];
  const rows = entries.map(entry => [
    entry.name,
    entry.furigana,
    entry.displayName,
    entry.status,
    ...fieldDefs.map(fieldDef =>
      formatCustomFieldValue(
        fieldDef,
        entry.customFieldValues[fieldDef.fieldKey],
      ),
    ),
  ]);
  return [headers, ...rows]
    .map(row => row.map(renderCell).join(','))
    .join('\r\n');
}

/**
 * Flattens one stored custom field answer into a single cell, matching how
 * the staff detail page renders the same answer.
 *
 * A boolean checkbox stores its own field key when checked, which means
 * nothing to a reader, so a stored answer exports as a yes/no label; an
 * entry with no stored answer at all still exports as an empty cell, so a
 * field added after those entries were submitted isn't reported as a `no`
 * nobody gave. A checkbox offering options stores every selected one, so
 * those are joined into one cell rather than spilling into columns the
 * header row doesn't cover.
 * @param fieldDef The field the answer belongs to.
 * @param value The stored answer, or `undefined` when the entry has none.
 */
function formatCustomFieldValue(
  fieldDef: FormFieldDef,
  value: string | string[] | undefined,
): string {
  if (isBooleanCheckbox(fieldDef)) {
    if (value === undefined) {
      return '';
    }
    return Array.isArray(value) && value.includes(fieldDef.fieldKey)
      ? BOOLEAN_CHECKBOX_LABELS.checked
      : BOOLEAN_CHECKBOX_LABELS.unchecked;
  }
  if (Array.isArray(value)) {
    return value.join(MULTI_VALUE_SEPARATOR);
  }
  return value ?? '';
}

/**
 * Renders one cell: neutralizes anything a spreadsheet would evaluate, then
 * quotes it for RFC 4180.
 * @param value The raw cell value.
 */
function renderCell(value: string): string {
  return csvEscape(neutralizeFormula(value));
}

/**
 * Prefixes a cell that starts like a spreadsheet formula with an apostrophe,
 * which Excel and Google Sheets read as "treat the rest as literal text".
 *
 * Entry names and free-text answers are arbitrary participant input, so
 * without this a value such as `=HYPERLINK(...)` would be evaluated when
 * staff open the export. RFC 4180 quoting alone does not prevent that: the
 * quotes are consumed while parsing the field, and the formula survives.
 *
 * Only the leading character is inspected, so legitimate values such as `-3`
 * or `-太郎` are prefixed too. That is deliberate: Excel and Google Sheets —
 * the spreadsheet apps this export is meant to be opened in — hide the
 * apostrophe, and deciding whether the rest really parses as a formula would
 * mean reimplementing a spreadsheet parser, where a miss is an injection.
 * Other readers (Numbers, `pandas.read_csv()`, ...) show it as an ordinary
 * character instead.
 * The cost is that this export cannot be read back programmatically — see
 * the CSV section of `docs/api-endpoints.md` and issue #67.
 * @param value The raw cell value.
 */
function neutralizeFormula(value: string): string {
  return FORMULA_LEAD_PATTERN.test(value) ? `'${value}` : value;
}

/**
 * Quotes a cell that would otherwise break the row/field structure,
 * doubling any embedded quotes (RFC 4180).
 * @param value The cell value, already neutralized.
 */
function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
