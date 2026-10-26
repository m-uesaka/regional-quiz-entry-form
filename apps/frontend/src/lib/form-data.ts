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
