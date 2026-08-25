import type {FormFieldDef} from '../schemas/form-definition';

/** The answers to a tournament's custom form fields, keyed by field key. */
export type CustomFieldValues = Record<string, string | string[]>;

/**
 * The options a submitted value selects, normalized to a list so every field
 * type can be checked the same way. A `checkbox` answer is already a list
 * (a boolean checkbox stores `[fieldKey]` when checked); a `radio` /
 * `textarea` answer is a single string, and an empty one selects nothing.
 */
function selectedOptions(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined || value === '' ? [] : [value];
}

/**
 * Checks submitted custom field answers against the tournament's own form
 * field definitions, so an API client can't store answers the rendered form
 * could never have produced (unknown fields, options that aren't offered, or
 * a required field left blank).
 *
 * A missing key counts as an empty answer, which is only an error when the
 * field is required.
 * @param fieldDefs The tournament's custom form field definitions.
 * @param values The submitted answers.
 * @return `null` when the answers are valid, otherwise the reason they
 *     aren't.
 */
export function findCustomFieldValuesError(
  fieldDefs: FormFieldDef[],
  values: CustomFieldValues,
): string | null {
  const definedKeys = new Set(fieldDefs.map(fieldDef => fieldDef.fieldKey));
  for (const key of Object.keys(values)) {
    if (!definedKeys.has(key)) {
      return `unknown custom field: ${key}`;
    }
  }

  for (const fieldDef of fieldDefs) {
    const value = values[fieldDef.fieldKey];
    if (fieldDef.fieldType === 'checkbox') {
      // A scalar answer would pass the option check below but the rendered
      // form only shows checkbox selections stored as a list, so the
      // selection would silently disappear when the entry is reopened.
      if (value !== undefined && !Array.isArray(value)) {
        return `custom field expects a list of values: ${fieldDef.fieldKey}`;
      }
    } else if (Array.isArray(value)) {
      return `custom field expects a single value: ${fieldDef.fieldKey}`;
    }

    const selected = selectedOptions(value);
    if (fieldDef.required && selected.length === 0) {
      return `custom field is required: ${fieldDef.fieldKey}`;
    }

    // A `textarea` answer is free text, so only fields offering a fixed set
    // of choices can be checked against it. A boolean checkbox (no options)
    // offers exactly one implicit choice: its own key.
    const allowed =
      fieldDef.fieldType === 'checkbox' &&
      (!fieldDef.options || fieldDef.options.length === 0)
        ? [fieldDef.fieldKey]
        : fieldDef.options;
    if (fieldDef.fieldType === 'textarea' || !allowed) {
      continue;
    }
    for (const option of selected) {
      if (!allowed.includes(option)) {
        return `custom field has an unknown option: ${fieldDef.fieldKey}`;
      }
    }
  }

  return null;
}
