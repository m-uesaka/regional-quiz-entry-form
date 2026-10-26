// The common-password check on its own, without `zod` or the schemas of
// `./password-policy.ts`, so a browser can load it too (#177): the password
// forms show whether a password will be accepted before it is sent. It is
// still kept out of the package's `index.ts`, because the list behind it is
// ~30 KB; the forms load it lazily, with a dynamic `import()`, so it is a
// chunk of its own that only a page with a password to set ever fetches.
import {COMMON_PASSWORDS} from './schemas/common-passwords';

/**
 * Whether `password` is one of the passwords everyone else uses, compared
 * case-insensitively (`Password1` is no better than `password1`).
 * @param password The password being set.
 */
export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}
