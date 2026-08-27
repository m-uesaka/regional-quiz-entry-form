import type {CustomFieldValues, FormFieldDef} from '@regional-quiz/shared';

/**
 * Rebuilds the `customFieldValues` map from a submitted form, driven by the
 * tournament's own field definitions rather than by whatever keys the
 * request happens to carry.
 *
 * Checkbox fields are read with `getAll()` since a multi-option group
 * submits one value per checked box; a plain boolean checkbox (no options)
 * submits the browser's default `"on"`, which is normalized to the
 * `[fieldKey]` / `[]` representation `DynamicFormField.svelte` uses.
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
    if (fieldDef.fieldType !== 'checkbox') {
      values[fieldDef.fieldKey] = String(formData.get(fieldDef.fieldKey) ?? '');
      continue;
    }
    const checked = formData.getAll(fieldDef.fieldKey).map(String);
    if (fieldDef.options && fieldDef.options.length > 0) {
      values[fieldDef.fieldKey] = checked;
    } else {
      values[fieldDef.fieldKey] = checked.length > 0 ? [fieldDef.fieldKey] : [];
    }
  }
  return values;
}
