import type {
  CustomFieldValues,
  CustomFieldValuesError,
  CustomFieldValuesErrorReason,
  FormFieldDef,
} from '@regional-quiz/shared';
import {customFieldName} from '$lib/custom-field-name';

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
      values[fieldDef.fieldKey] = String(formData.get(controlName) ?? '');
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
 * the field's own label. Only `required` describes something the rendered
 * form lets them do — the others mean the body didn't come from the form,
 * so they say no more than "check this field".
 */
const CUSTOM_FIELD_ERROR_MESSAGES: Record<
  CustomFieldValuesErrorReason,
  (label: string) => string
> = {
  required: label => `「${label}」は必須です`,
  'unknown-option': label => `「${label}」の選択内容が正しくありません`,
  'unknown-field': label => `「${label}」の入力内容を確認してください`,
  'expects-list': label => `「${label}」の入力内容を確認してください`,
  'expects-single': label => `「${label}」の入力内容を確認してください`,
};

/**
 * Turns a rejected custom field answer into the per-field messages a form
 * page renders, keyed by the namespaced control name the answer was
 * submitted under — the same keys the form's own fields use, so a custom
 * field keyed `name` can't overwrite the real name field's message.
 *
 * A rejection naming a key the tournament doesn't define has no control to
 * point at, so it produces no per-field message and is left to the
 * form-level one.
 * @param error The rejection `findCustomFieldValuesError()` returned.
 * @param fieldDefs The tournament's custom form field definitions.
 */
export function customFieldErrors(
  error: CustomFieldValuesError,
  fieldDefs: FormFieldDef[],
): Record<string, string[]> {
  const fieldDef = fieldDefs.find(def => def.fieldKey === error.fieldKey);
  if (!fieldDef) {
    return {};
  }
  const message = CUSTOM_FIELD_ERROR_MESSAGES[error.reason](fieldDef.label);
  return {[customFieldName(fieldDef.fieldKey)]: [message]};
}
