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
 * Whether `fieldDef` is a plain boolean checkbox — a `checkbox` field that
 * offers no options of its own. It stores "checked" as a list containing
 * the field's own key and "unchecked" as an empty list, so it is the one
 * field type whose stored value isn't meaningful to a reader as-is.
 * @param fieldDef The form field definition to test.
 */
export function isBooleanCheckbox(fieldDef: FormFieldDef): boolean {
  return (
    fieldDef.fieldType === 'checkbox' &&
    (!fieldDef.options || fieldDef.options.length === 0)
  );
}

/** Japanese display labels for a boolean checkbox's two states. */
export const BOOLEAN_CHECKBOX_LABELS = {checked: 'はい', unchecked: 'いいえ'};

/**
 * Why a submitted custom field answer was rejected. Only `required` is
 * something the rendered form lets a participant produce (by submitting
 * before the client bundle has taken the form over, or with JS off — see
 * #95); the rest describe a body the form could never have sent.
 */
export type CustomFieldValuesErrorReason =
  | 'unknown-field'
  | 'expects-list'
  | 'expects-single'
  | 'required'
  | 'unknown-option';

/** The wording each reason is reported to an API client with. */
const REASON_MESSAGES: Record<CustomFieldValuesErrorReason, string> = {
  'unknown-field': 'unknown custom field',
  'expects-list': 'custom field expects a list of values',
  'expects-single': 'custom field expects a single value',
  required: 'custom field is required',
  'unknown-option': 'custom field has an unknown option',
};

/** A rejected custom field answer: which field, and why. */
export interface CustomFieldValuesError {
  reason: CustomFieldValuesErrorReason;
  /**
   * The field the rejected answer was given for. For `unknown-field` this
   * is the submitted key itself, which no definition claims.
   */
  fieldKey: string;
  /**
   * The English identifier the API answers a rejected submission with. A
   * caller showing this to a person is expected to word it from `reason`
   * and the field's own label instead.
   */
  message: string;
}

/**
 * Builds the rejection a caller sees, so `reason` and `message` can't drift
 * apart.
 * @param reason Why the answer was rejected.
 * @param fieldKey The field the rejected answer was given for.
 */
function rejection(
  reason: CustomFieldValuesErrorReason,
  fieldKey: string,
): CustomFieldValuesError {
  return {
    reason,
    fieldKey,
    message: `${REASON_MESSAGES[reason]}: ${fieldKey}`,
  };
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
 * @return `null` when the answers are valid, otherwise which field was
 *     rejected and why.
 */
export function findCustomFieldValuesError(
  fieldDefs: FormFieldDef[],
  values: CustomFieldValues,
): CustomFieldValuesError | null {
  const definedKeys = new Set(fieldDefs.map(fieldDef => fieldDef.fieldKey));
  for (const key of Object.keys(values)) {
    if (!definedKeys.has(key)) {
      return rejection('unknown-field', key);
    }
  }

  for (const fieldDef of fieldDefs) {
    const value = values[fieldDef.fieldKey];
    if (fieldDef.fieldType === 'checkbox') {
      // A scalar answer would pass the option check below but the rendered
      // form only shows checkbox selections stored as a list, so the
      // selection would silently disappear when the entry is reopened.
      if (value !== undefined && !Array.isArray(value)) {
        return rejection('expects-list', fieldDef.fieldKey);
      }
    } else if (Array.isArray(value)) {
      return rejection('expects-single', fieldDef.fieldKey);
    }

    const selected = selectedOptions(value);
    if (fieldDef.required && selected.length === 0) {
      return rejection('required', fieldDef.fieldKey);
    }

    // A `textarea` answer is free text, so only fields offering a fixed set
    // of choices can be checked against it. A boolean checkbox (no options)
    // offers exactly one implicit choice: its own key.
    const allowed = isBooleanCheckbox(fieldDef)
      ? [fieldDef.fieldKey]
      : fieldDef.options;
    if (fieldDef.fieldType === 'textarea' || !allowed) {
      continue;
    }
    for (const option of selected) {
      if (!allowed.includes(option)) {
        return rejection('unknown-option', fieldDef.fieldKey);
      }
    }
  }

  return null;
}
