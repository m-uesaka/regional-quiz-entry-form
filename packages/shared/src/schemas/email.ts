import {z} from 'zod';

/**
 * An email address as an account is identified by it: validated, then
 * lowercased (#133).
 *
 * The domain part of an address is case-insensitive, and every major
 * provider treats the local part the same way, so `Foo@example.com` and
 * `foo@example.com` are one mailbox. Postgres compares `text` exactly,
 * though, so an address stored as typed made them two accounts: an entry
 * under the other spelling created a second participant (skipping the
 * password check that proves the address is theirs), and a login under it
 * found no row and answered the same 401 as a wrong password.
 *
 * Lowercasing here, at the boundary, means the backend's lookups and inserts
 * and the frontend's forms all see the same spelling without any of them
 * having to remember to. The tables back it up with an `email = lower(email)`
 * check (`0025_lowercase_emails.sql`), so a write that skipped this schema
 * fails instead of quietly creating the second spelling again.
 *
 * Zod's `.email()` admits ASCII only, so `toLowerCase()` here and Postgres'
 * `lower()` there can't disagree on what the lowercase form is.
 *
 * Only for addresses coming *in* (forms, request bodies). A schema
 * describing a response keeps a plain `z.string().email()`: the address it
 * carries was already lowercased on the way in.
 * @param message The message to show for a malformed address, for schemas
 *     whose errors reach a Japanese form as-is.
 */
export function emailAddressSchema(message?: string) {
  return z
    .string()
    .email(message === undefined ? undefined : {message})
    .toLowerCase();
}
