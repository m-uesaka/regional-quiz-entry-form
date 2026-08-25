import {FormFieldDefSchema, type FormFieldDef} from '@regional-quiz/shared';

/**
 * The `form_field_defs` columns every API response exposing a tournament's
 * custom form fields selects, in the order `FormFieldDefRow` declares them.
 */
export const FORM_FIELD_DEF_COLUMNS =
  'field_key, label, field_type, required, options, display_order';

/** Shape of a `form_field_defs` row as selected above (snake_case). */
export interface FormFieldDefRow {
  field_key: string;
  label: string;
  // A plain `string` at the database boundary (the column is `text` with a
  // check constraint, not an enum); `toFormFieldDef()` is what narrows it to
  // the `FormFieldType` union at runtime.
  field_type: string;
  required: boolean;
  options: string[] | null;
  display_order: number;
}

/**
 * Converts a selected `form_field_defs` row into the camelCase API shape,
 * validating it against `FormFieldDefSchema`.
 * @param row The row as selected with `FORM_FIELD_DEF_COLUMNS`.
 */
export function toFormFieldDef(row: FormFieldDefRow): FormFieldDef {
  return FormFieldDefSchema.parse({
    fieldKey: row.field_key,
    label: row.label,
    fieldType: row.field_type,
    required: row.required,
    options: row.options,
    displayOrder: row.display_order,
  });
}
