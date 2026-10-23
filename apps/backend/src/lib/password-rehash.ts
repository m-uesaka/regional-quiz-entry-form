import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {hashPassword} from './password';

/** The tables whose rows carry a `password_hash` column. */
export type PasswordTable = 'participants' | 'staff_accounts';

/**
 * Replaces a hash `verifyPassword()` reported `needsRehash` for with one made
 * with the current parameters.
 *
 * A successful login is the only moment the plaintext is in hand, so this is
 * how stored hashes move to new parameters without asking anyone to do
 * anything. It is best-effort: it never rejects, and a failure is logged and
 * left for the next login to try again -- a login must not fail because its
 * hash could not be upgraded.
 *
 * The update is conditional on the row still holding `storedHash`. A password
 * reset that lands between the verification and this write has set a
 * password the caller doesn't know; overwriting it with a hash of the old
 * one would silently undo the reset. `password_changed_at` is deliberately
 * left alone: the password has not changed, and bumping it would end the
 * participant's sessions -- including the one this login just issued.
 * @param env The Worker bindings.
 * @param table The table the account lives in.
 * @param id The account's id.
 * @param password The plaintext the login just verified.
 * @param storedHash The hash it was verified against.
 */
export async function rehashPassword(
  env: Bindings,
  table: PasswordTable,
  id: string,
  password: string,
  storedHash: string,
): Promise<void> {
  try {
    const {error} = await createDbClient(env)
      .from(table)
      .update({password_hash: await hashPassword(password)})
      .eq('id', id)
      .eq('password_hash', storedHash);
    if (error) {
      console.error('failed to rehash a password', {
        table,
        id,
        error: error.message,
      });
    }
  } catch (e) {
    console.error('failed to rehash a password', {
      table,
      id,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
