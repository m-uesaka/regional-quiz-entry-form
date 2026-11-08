import type {CustomFieldValues} from '@regional-quiz/shared';
import type {FieldErrors} from '$lib/types/form-errors';

/**
 * The entry form's own fields, echoed back verbatim after a failed
 * submission so the form can re-render what the participant typed. The two
 * password fields are deliberately absent: re-rendering a password into the
 * HTML would put it in the page source and in any cache of it.
 */
export interface EntryFormValues {
  name: string;
  furigana: string;
  displayName: string;
  email: string;
  regulationIds: string[];
  freeText: string;
  customFieldValues: CustomFieldValues;
}

/**
 * The edit form's own fields, echoed back verbatim after a failed
 * submission. Narrower than `EntryFormValues`: an existing entry's email
 * address and regulation aren't editable.
 */
export interface EntryEditFormValues {
  name: string;
  furigana: string;
  displayName: string;
  freeText: string;
  customFieldValues: CustomFieldValues;
}

/** Per-field validation messages on the entry and edit forms. */
export type EntryFieldErrors = FieldErrors;
