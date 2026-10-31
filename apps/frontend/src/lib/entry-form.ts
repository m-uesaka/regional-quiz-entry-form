import type {CustomFieldValues, FormFieldDef} from '@regional-quiz/shared';
import type {EntryFieldErrors} from '$lib/types/entry-form';

/**
 * The message to show under one control, which is the first of those filed
 * for it.
 * @param fieldErrors The last rejected submission's messages, if there was one.
 * @param field The control's name.
 */
export function firstFieldError(
  fieldErrors: EntryFieldErrors | undefined,
  field: string,
): string | undefined {
  return fieldErrors?.[field]?.[0];
}

/**
 * The answer every custom field starts out with, keyed by field key.
 * Every key the form renders is seeded, unanswered ones included, so that
 * `DynamicFormField` always has a value of the right shape to bind to.
 * @param formFieldDefs The tournament's custom form field definitions.
 * @param answered The answers there already are, if any.
 */
export function initialCustomFieldValues(
  formFieldDefs: FormFieldDef[],
  answered: CustomFieldValues = {},
): CustomFieldValues {
  return Object.fromEntries(
    formFieldDefs.map(fieldDef => [
      fieldDef.fieldKey,
      answered[fieldDef.fieldKey] ??
        (fieldDef.fieldType === 'checkbox' ? [] : ''),
    ]),
  );
}
