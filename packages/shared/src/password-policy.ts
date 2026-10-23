// The rules for a password being *set*, and the schemas of the endpoints that
// set one.
//
// Deliberately not re-exported from the package's `index.ts`: the list in
// `schemas/common-passwords.ts` is ~30 KB, and anything the barrel exports
// ends up in the browser bundle of every page that imports anything from
// `@regional-quiz/shared`. Import it as `@regional-quiz/shared/password-policy`
// and only from server code (the backend, `+page.server.ts`).
import {z} from 'zod';
import {COMMON_PASSWORDS} from './schemas/common-passwords';
import {PasswordLengthSchema} from './schemas/password';

/**
 * Whether `password` is one of the passwords everyone else uses, compared
 * case-insensitively (`Password1` is no better than `password1`).
 * @param password The password being set.
 */
export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

/**
 * The rules for a password being *set*: on a reset, when staff choose theirs
 * from an invite link, and -- applied by the backend once it knows the
 * address is new -- at entry time.
 *
 * Refusing the passwords everyone else uses does more than demanding a longer
 * one. Character-class rules (a symbol, a digit, ...) are deliberately
 * absent: they cost the user more than they buy, and mostly produce
 * `Password1!`.
 *
 * Not for proving a password that already exists (a login, or an entry under
 * a registered address): an account whose password predates these rules must
 * still be able to use it.
 */
export const PasswordSchema = PasswordLengthSchema.refine(
  password => !isCommonPassword(password),
  {
    message:
      'よく使われているパスワードのため使用できません。別のパスワードを入力してください',
  },
);

// `newPassword` follows the same `PasswordSchema` as a new participant's
// password at entry time, so a reset can't weaken an account below what
// signing up would have allowed.
export const PasswordResetConfirmInputSchema = z.object({
  token: z.string().min(1),
  newPassword: PasswordSchema,
});
export type PasswordResetConfirmInput = z.infer<
  typeof PasswordResetConfirmInputSchema
>;

// The body of `POST /api/auth/staff/password-reset/confirm`, which a staff
// member reaches from the invite (or re-issued reset) link mailed to them.
//
// It is deliberately its own schema rather than a reuse of
// `PasswordResetConfirmInputSchema`: the two are separate endpoints with
// separate token tables, and a password rule tightened for staff should not
// silently move the participant form with it. (Today both use
// `PasswordSchema`; tightening staff alone means replacing it here.)
export const StaffPasswordResetConfirmInputSchema = z.object({
  token: z.string().min(1),
  newPassword: PasswordSchema,
});
export type StaffPasswordResetConfirmInput = z.infer<
  typeof StaffPasswordResetConfirmInputSchema
>;
