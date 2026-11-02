import {
  findCustomFieldValuesError,
  FormFieldDefSchema,
  labelPlainText,
  type CustomFieldValues,
  type FormFieldDef,
} from '@regional-quiz/shared';
import type {createDbClient} from './db';
import type {LibFailure} from './errors';

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
 * validating it against `FormFieldDefSchema`. `plainLabel` is derived here
 * from the stored label, so every API response carries it.
 * @param row The row as selected with `FORM_FIELD_DEF_COLUMNS`.
 */
export function toFormFieldDef(row: FormFieldDefRow): FormFieldDef {
  return FormFieldDefSchema.parse({
    fieldKey: row.field_key,
    label: row.label,
    plainLabel: labelPlainText(row.label),
    fieldType: row.field_type,
    required: row.required,
    options: row.options,
    displayOrder: row.display_order,
  });
}

/** A tournament's custom form fields, or the error that stopped the read. */
export type FormFieldDefsResult =
  | {fieldDefs: FormFieldDef[]; error: null}
  | {fieldDefs: null; error: {message: string}};

/**
 * Reads a tournament's custom form fields in display order.
 *
 * A failed read comes back as the database's own error rather than a
 * response: some callers log it and answer with `internalError()`, others
 * carry its message in their own result type, so the choice stays with them.
 * So does an answer with no rows array at all: read as "no custom fields", it
 * would drop the required fields from the form and from the check of what is
 * submitted against it.
 *
 * A row the schema refuses is not a failed read but data that shouldn't exist,
 * and throws.
 * @param db The Supabase client to query with.
 * @param tournamentId The tournament whose form fields are read.
 * @throws ZodError If a stored row doesn't fit `FormFieldDefSchema`.
 */
export async function fetchFormFieldDefs(
  db: ReturnType<typeof createDbClient>,
  tournamentId: string,
): Promise<FormFieldDefsResult> {
  const {data, error} = await db
    .from('form_field_defs')
    .select(FORM_FIELD_DEF_COLUMNS)
    .eq('tournament_id', tournamentId)
    .order('display_order', {ascending: true})
    .returns<FormFieldDefRow[]>();
  if (error) {
    return {fieldDefs: null, error};
  }
  if (!data) {
    return {
      fieldDefs: null,
      error: {message: 'the form field defs read returned no data'},
    };
  }
  return {fieldDefs: data.map(toFormFieldDef), error: null};
}

/** Whether submitted custom field answers fit the tournament's form. */
export type CustomFieldValuesCheck = {ok: true} | LibFailure<400>;

/**
 * Checks submitted custom field answers against the tournament's form:
 * a 400 for answers that don't fit it, a 500 carrying the database's message
 * when the form can't be read. Throws what `fetchFormFieldDefs()` throws.
 * @param db The Supabase client to query with.
 * @param tournamentId The tournament the answers were submitted to.
 * @param values The submitted answers.
 */
export async function validateCustomFieldValues(
  db: ReturnType<typeof createDbClient>,
  tournamentId: string,
  values: CustomFieldValues,
): Promise<CustomFieldValuesCheck> {
  const {fieldDefs, error} = await fetchFormFieldDefs(db, tournamentId);
  if (error) {
    return {ok: false, status: 500, error: error.message};
  }
  const valuesError = findCustomFieldValuesError(fieldDefs, values);
  if (valuesError) {
    return {ok: false, status: 400, error: valuesError.message};
  }
  return {ok: true};
}
