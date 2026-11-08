/**
 * Reads one text control, which `FormData` types as possibly a file.
 * @param formData The submitted body.
 * @param name The control's name.
 * @return The control's value, or `''` if it is missing or a file.
 */
export function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * Reads every value of a control that can be submitted more than once -- a
 * checkbox group, say -- leaving out any that came as a file, the same way
 * `readString` reads a file as `''`.
 * @param formData The submitted body.
 * @param name The control's name.
 * @return The control's text values, in the order they were submitted.
 */
export function readStrings(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === 'string');
}
