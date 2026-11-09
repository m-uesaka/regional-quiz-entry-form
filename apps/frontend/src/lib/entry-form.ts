import {
  customFieldValueOf,
  type CustomFieldValues,
  type FormFieldDef,
  type FormFieldType,
} from '@regional-quiz/shared';
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
 * An answer in the shape its field's control binds to: a list for a
 * `checkbox` field, text for any other. A missing answer becomes the empty
 * one, and one of the other shape is fitted rather than passed on, so a field
 * whose type changed since the answer was given doesn't show a list as text
 * or hand `bind:group` a string. A lone string becomes a one-item list; a list
 * for a text or radio field is dropped, since no single item of it is the
 * answer.
 * @param fieldType The field's type.
 * @param answer The answer there is, if any.
 */
export function customFieldValueFor(
  fieldType: FormFieldType,
  answer: string | string[] | undefined,
): string | string[] {
  if (fieldType === 'checkbox') {
    if (Array.isArray(answer)) return answer;
    return answer === undefined || answer === '' ? [] : [answer];
  }
  return typeof answer === 'string' ? answer : '';
}

/**
 * The answer every custom field starts out with, keyed by field key.
 * Every key the form renders is seeded, unanswered ones included, in the
 * shape its control binds to (`customFieldValueFor()`).
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
      customFieldValueFor(
        fieldDef.fieldType,
        customFieldValueOf(answered, fieldDef.fieldKey),
      ),
    ]),
  );
}
