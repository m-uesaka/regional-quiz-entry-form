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
 * Rows are separated by CRLF and there is no trailing newline, per RFC 4180.
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
    .map(row => row.map(csvEscape).join(','))
    .join('\r\n');
}

/**
 * Flattens one stored custom field answer into a single cell, matching how
 * the staff detail page renders the same answer.
 *
 * A boolean checkbox stores its own field key when checked, which means
 * nothing to a reader, so it exports as a yes/no label. A checkbox offering
 * options stores every selected one, so those are joined into one cell
 * rather than spilling into columns the header row doesn't cover.
 * @param fieldDef The field the answer belongs to.
 * @param value The stored answer, or `undefined` when the entry has none.
 */
function formatCustomFieldValue(
  fieldDef: FormFieldDef,
  value: string | string[] | undefined,
): string {
  if (isBooleanCheckbox(fieldDef)) {
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
 * Quotes a cell that would otherwise break the row/field structure,
 * doubling any embedded quotes (RFC 4180).
 * @param value The raw cell value.
 */
function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
