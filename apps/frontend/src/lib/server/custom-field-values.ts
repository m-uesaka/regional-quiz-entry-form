import {
  CUSTOM_FIELD_VALUE_MAX_LENGTH,
  type CustomFieldValues,
  type CustomFieldValuesError,
  type CustomFieldValuesErrorReason,
  type FormFieldDef,
} from '@regional-quiz/shared';
import {customFieldName} from '$lib/custom-field-name';

/**
 * Reads a text control from a submitted form with its line breaks as `\n`.
 *
 * A browser submits every line break in a `<textarea>` as CRLF, but its
 * `maxlength` counts one as a single character. Read as submitted, an
 * answer the browser let through at exactly the limit would come out over
 * it -- one character over for every line break -- and be refused by the
 * schema's own `max()`. Normalizing here makes the page, the schema, the
 * API and the database all count the same string.
 * @param formData The submitted form body.
 * @param name The control's name.
 */
export function readFormText(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').replace(/\r\n?/g, '\n');
}

/**
 * Rebuilds the `customFieldValues` map from a submitted form, driven by the
 * tournament's own field definitions rather than by whatever keys the
 * request happens to carry.
 *
 * Checkbox fields are read with `getAll()` since a multi-option group
 * submits one value per checked box; a plain boolean checkbox (no options)
 * submits a single value, which is normalized to the `[fieldKey]` / `[]`
 * representation `DynamicFormField.svelte` uses regardless of what that
 * value is.
 *
 * The controls are read under their namespaced `custom.`-prefixed names
 * (see `$lib/custom-field-name`), so a field key that collides with one of
 * the form's own inputs can't be answered by that input's value; the
 * returned map is still keyed by the bare field key, which is the shape the
 * API stores.
 *
 * A text answer's line breaks are read as `\n` (`readFormText()`).
 *
 * Shared by the entry form and the mypage edit form, so an answer accepted
 * on one is read the same way on the other.
 * @param formData The submitted form body.
 * @param fieldDefs The tournament's custom form field definitions.
 */
export function readCustomFieldValues(
  formData: FormData,
  fieldDefs: FormFieldDef[],
): CustomFieldValues {
  const values: CustomFieldValues = {};
  for (const fieldDef of fieldDefs) {
    const controlName = customFieldName(fieldDef.fieldKey);
    if (fieldDef.fieldType !== 'checkbox') {
      values[fieldDef.fieldKey] = readFormText(formData, controlName);
      continue;
    }
    const checked = formData.getAll(controlName).map(String);
    if (fieldDef.options && fieldDef.options.length > 0) {
      values[fieldDef.fieldKey] = checked;
    } else {
      values[fieldDef.fieldKey] = checked.length > 0 ? [fieldDef.fieldKey] : [];
    }
  }
  return values;
}

/**
 * The wording each rejection reason gets in front of a participant, given
 * the field's own label as plain text (`plainLabel`). Only `required` and `too-long` describe something
 * the rendered form lets them do — the others mean the body didn't come
 * from the form, so they say no more than "check this field".
 */
const CUSTOM_FIELD_ERROR_MESSAGES: Record<
  CustomFieldValuesErrorReason,
  (label: string) => string
> = {
  required: label => `「${label}」は必須です`,
  'too-long': label =>
    `「${label}」は${CUSTOM_FIELD_VALUE_MAX_LENGTH}文字以内で入力してください`,
  'unknown-option': label => `「${label}」の選択内容が正しくありません`,
  'unknown-field': label => `「${label}」の入力内容を確認してください`,
  'expects-list': label => `「${label}」の入力内容を確認してください`,
  'expects-single': label => `「${label}」の入力内容を確認してください`,
};

/**
 * Turns rejected custom field answers into the per-field messages a form
 * page renders, keyed by the namespaced control name each answer was
 * submitted under — the same keys the form's own fields use, so a custom
 * field keyed `name` can't overwrite the real name field's message.
 *
 * A rejection naming a key the tournament doesn't define has no control to
 * point at, so it produces no per-field message and is left to the
 * form-level one.
 * @param errors The rejections `findCustomFieldValuesErrors()` returned.
 * @param fieldDefs The tournament's custom form field definitions.
 */
export function customFieldErrors(
  errors: CustomFieldValuesError[],
  fieldDefs: FormFieldDef[],
): Record<string, string[]> {
  const messages: Record<string, string[]> = {};
  for (const error of errors) {
    const fieldDef = fieldDefs.find(def => def.fieldKey === error.fieldKey);
    if (!fieldDef) {
      continue;
    }
    messages[customFieldName(fieldDef.fieldKey)] = [
      CUSTOM_FIELD_ERROR_MESSAGES[error.reason](fieldDef.plainLabel),
    ];
  }
  return messages;
}

/**
 * The schema's messages for a rejected entry, keyed by field as
 * `ZodError.flatten().fieldErrors` keys them -- minus those raised by one
 * custom field answer being too long.
 *
 * `findCustomFieldValuesErrors()` reports that same answer as `too-long`,
 * and `customFieldErrors()` puts it under the control that caused it.
 * Flattened, the schema's copy would land under `customFieldValues` as well,
 * which the form shows as a line of its own; that line is kept for what
 * only the schema checks, the combined length of all the answers.
 * @param issues The `issues` of the schema's `ZodError`.
 */
export function entrySchemaFieldErrors(
  issues: ReadonlyArray<{path: ReadonlyArray<PropertyKey>; message: string}>,
): Record<string, string[] | undefined> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const [field] = issue.path;
    if (typeof field !== 'string') {
      continue;
    }
    if (field === 'customFieldValues' && issue.path.length > 1) {
      continue;
    }
    (fieldErrors[field] ??= []).push(issue.message);
  }
  return fieldErrors;
}
