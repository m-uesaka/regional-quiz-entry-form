import {z} from 'zod';
import {COMMON_PASSWORDS} from './common-passwords';

export const PASSWORD_MIN_LENGTH = 8;
// PBKDF2 costs time in proportion to its input, so without a ceiling a
// request could make a login or an entry spend CPU on a megabyte "password".
// 256 is far beyond any passphrase anyone types.
export const PASSWORD_MAX_LENGTH = 256;

/**
 * The rules for a password being *set*: at entry time, on a reset, and when
 * staff choose theirs from an invite link.
 *
 * Refusing the passwords everyone else uses does more than demanding a longer
 * one, so the list in `common-passwords.ts` is checked case-insensitively
 * (`Password1` is no better than `password1`). Character-class rules
 * (a symbol, a digit, ...) are deliberately absent: they cost the user more
 * than they buy, and mostly produce `Password1!`.
 *
 * Not for logging in. An account whose password predates this rule must
 * still be able to log in with it; login inputs only share the maximum
 * length, which protects the hash rather than judging the password.
 */
export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    message: `パスワードは${PASSWORD_MIN_LENGTH}文字以上で入力してください`,
  })
  .max(PASSWORD_MAX_LENGTH, {
    message: `パスワードは${PASSWORD_MAX_LENGTH}文字以内で入力してください`,
  })
  .refine(password => !COMMON_PASSWORDS.has(password.toLowerCase()), {
    message:
      'よく使われているパスワードのため使用できません。別のパスワードを入力してください',
  });
