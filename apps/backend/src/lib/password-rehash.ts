import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  isPasswordHashUsable,
  verifyPassword,
} from './password';

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

/** The columns `verifyAccountPassword()` reads off an account row. */
export interface PasswordAccount {
  id: string;
  password_hash: string;
}

/**
 * Checks a password submitted for an account -- at login, or when an entry
 * re-uses a registered address -- and schedules the hash upgrade a correct
 * one earns.
 *
 * Every place that proves a password goes through here, so none of them can
 * forget either half:
 *
 * - The work is the same whether or not the password could match. A missing
 *   account, and one whose hash is unusable (a staff invite not followed yet,
 *   a corrupted value, a count above the Workers cap), are verified against
 *   `DUMMY_PASSWORD_HASH` rather than refused at once, which would answer
 *   ~17 ms sooner and so tell an attacker the address is registered.
 * - A correct password on an older hash hands `rehashPassword()` to `defer`,
 *   with the hash it was verified against, so the caller decides when it
 *   runs (after the response, or before carrying on) but not whether.
 * @param env The Worker bindings.
 * @param table The table `account` was read from.
 * @param account The account the address belongs to, or `null` if none.
 * @param password The submitted password.
 * @param defer Receives the upgrade, if there is one to run.
 * @return Whether `account` exists and `password` is its password.
 */
export async function verifyAccountPassword(
  env: Bindings,
  table: PasswordTable,
  account: PasswordAccount | null,
  password: string,
  defer: (upgrade: Promise<void>) => void,
): Promise<boolean> {
  const storedHash =
    account && isPasswordHashUsable(account.password_hash)
      ? account.password_hash
      : DUMMY_PASSWORD_HASH;
  const {valid, needsRehash} = await verifyPassword(password, storedHash);
  if (!account || !valid) return false;
  if (needsRehash) {
    defer(rehashPassword(env, table, account.id, password, storedHash));
  }
  return true;
}
