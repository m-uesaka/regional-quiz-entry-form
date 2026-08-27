/**
 * The prefix every custom form field's control name carries.
 *
 * A tournament's custom field keys come from a staff-uploaded YAML and are
 * only constrained to `/^[a-z][a-z0-9_]*$/`, so nothing stops one from
 * being `name`, `email` or `password` — the same `name` attributes the
 * entry and mypage-edit forms give their own inputs. Without a namespace
 * the two controls would submit under one key, `formData.get()` would
 * return whichever came first, and a field keyed `password` would round
 * the plaintext password back into the re-rendered HTML.
 */
export const CUSTOM_FIELD_NAME_PREFIX = 'custom.';

/**
 * The `name` (and `id`) a custom field's form control is rendered with.
 * Only the submitted body is namespaced; the stored `customFieldValues`
 * map is still keyed by the bare field key.
 * @param fieldKey The field definition's key.
 */
export function customFieldName(fieldKey: string): string {
  return `${CUSTOM_FIELD_NAME_PREFIX}${fieldKey}`;
}
