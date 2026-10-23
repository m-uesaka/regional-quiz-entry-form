import {z} from 'zod';

export const PASSWORD_MIN_LENGTH = 8;
// PBKDF2 costs time in proportion to its input, so without a ceiling a
// request could make a login or an entry spend CPU on a megabyte "password".
// 256 is far beyond any passphrase anyone types.
export const PASSWORD_MAX_LENGTH = 256;
// What a login accepts. Looser than `PASSWORD_MAX_LENGTH` because passwords
// set before that maximum existed had none, and a login that refused one
// would lock its owner out of an account whose hash would still verify. It
// still bounds the hash computation, which costs ~1 ms per extra kilobyte.
export const LOGIN_PASSWORD_MAX_LENGTH = 1024;

/**
 * The length rules a password field on a form is held to, and nothing else.
 *
 * This is what the entry form's password is checked against, because that
 * one field is both how a new participant sets a password and how a
 * returning one proves theirs: refusing a common password here would lock
 * out every participant who chose one before the rule existed. The full
 * rules for a password being *set* (`PasswordSchema`) live in
 * `@regional-quiz/shared/password-policy`, which the backend applies once it
 * knows the address is new.
 */
export const PasswordLengthSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    message: `パスワードは${PASSWORD_MIN_LENGTH}文字以上で入力してください`,
  })
  .max(PASSWORD_MAX_LENGTH, {
    message: `パスワードは${PASSWORD_MAX_LENGTH}文字以内で入力してください`,
  });
