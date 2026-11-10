import {
  findCustomFieldValuesError,
  FormFieldDefSchema,
  labelPlainText,
  type CustomFieldValues,
  type FormFieldDef,
} from '@regional-quiz/shared';
import type {DbClient, Tables} from './db';
import {UnexpectedFailure, type ClientFailure} from './errors';

/**
 * The `form_field_defs` columns every API response exposing a tournament's
 * custom form fields selects, in the order `FormFieldDefRow` declares them.
 */
export const FORM_FIELD_DEF_COLUMNS =
  'field_key, label, field_type, required, options, display_order';

/**
 * Shape of a `form_field_defs` row as selected above (snake_case). Looser
 * than the API shape at the database boundary -- `field_type` is a plain
 * `text` column with a check constraint, not an enum, and `options` is
 * `jsonb` -- and `toFormFieldDef()` is what narrows both at runtime.
 */
export type FormFieldDefRow = Pick<
  Tables<'form_field_defs'>,
  | 'field_key'
  | 'label'
  | 'field_type'
  | 'required'
  | 'options'
  | 'display_order'
>;

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

/**
 * Reads a tournament's custom form fields in display order.
 *
 * A failed read is thrown (`UnexpectedFailure`), and so is an answer with no rows
 * array at all: read as "no custom fields", it would drop the required fields
 * from the form and from the check of what is submitted against it.
 *
 * A row the schema refuses is not a failed read but data that shouldn't exist,
 * and throws a `ZodError`.
 * @param db The Supabase client to query with.
 * @param tournamentId The tournament whose form fields are read.
 * @throws ZodError If a stored row doesn't fit `FormFieldDefSchema`.
 */
export async function fetchFormFieldDefs(
  db: DbClient,
  tournamentId: string,
): Promise<FormFieldDef[]> {
  const {data, error} = await db
    .from('form_field_defs')
    .select(FORM_FIELD_DEF_COLUMNS)
    .eq('tournament_id', tournamentId)
    .order('display_order', {ascending: true});
  if (error) {
    throw new UnexpectedFailure('failed to read the form field defs', error);
  }
  if (!data) {
    throw new UnexpectedFailure('failed to read the form field defs', {
      message: 'the form field defs read returned no data',
    });
  }
  return data.map(toFormFieldDef);
}

/** Whether submitted custom field answers fit the tournament's form. */
export type CustomFieldValuesCheck = {ok: true} | ClientFailure<400>;

/**
 * Checks submitted custom field answers against the tournament's form:
 * a 400 for answers that don't fit it. Throws what `fetchFormFieldDefs()`
 * throws when the form can't be read.
 * @param db The Supabase client to query with.
 * @param tournamentId The tournament the answers were submitted to.
 * @param values The submitted answers.
 */
export async function validateCustomFieldValues(
  db: DbClient,
  tournamentId: string,
  values: CustomFieldValues,
): Promise<CustomFieldValuesCheck> {
  const fieldDefs = await fetchFormFieldDefs(db, tournamentId);
  const valuesError = findCustomFieldValuesError(fieldDefs, values);
  if (valuesError) {
    return {ok: false, status: 400, error: valuesError.message};
  }
  return {ok: true};
}
