const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const SALT_HEX_LENGTH = SALT_BYTES * 2;
const HASH_HEX_LENGTH = (HASH_BITS / 8) * 2;
const HEX_PATTERN = /^[0-9a-f]+$/i;

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function deriveBits(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  return crypto.subtle.deriveBits(
    {name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256'},
    key,
    HASH_BITS,
  );
}

// Constant-time comparison so a wrong-password response can't be timed to
// leak how many leading hex digits of the hash matched.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const bits = await deriveBits(password, salt);
  return `${toHex(salt.buffer)}:${toHex(bits)}`;
}

/**
 * The placeholder written to a `password_hash` column for an account whose
 * owner has not chosen a password yet.
 *
 * `POST /api/staff/accounts` creates the row before the new staff member has
 * been anywhere near it, and the column is `not null`. This value is not a
 * hash in the format `hashPassword()` produces, so `verifyPassword()` returns
 * false for every password submitted against it and the account cannot be
 * logged into until the invite link replaces it.
 */
export const UNUSABLE_PASSWORD_HASH = 'invalid';

/**
 * Splits a stored hash into its salt and hash halves, or null if `stored` is
 * not in the format `hashPassword()` produces.
 * @param stored The value of the account's `password_hash` column.
 */
function parseStoredHash(stored: string): {salt: string; hash: string} | null {
  const parts = stored.split(':');
  if (parts.length !== 2) return null;
  const [saltHex, hashHex] = parts;
  if (
    saltHex.length !== SALT_HEX_LENGTH ||
    hashHex.length !== HASH_HEX_LENGTH ||
    !HEX_PATTERN.test(saltHex) ||
    !HEX_PATTERN.test(hashHex)
  ) {
    return null;
  }
  return {salt: saltHex, hash: hashHex};
}

/**
 * Whether any password could match `stored` at all, i.e. whether it is a hash
 * this module produced rather than `UNUSABLE_PASSWORD_HASH` (or anything else
 * malformed).
 *
 * Callers need this separately from `verifyPassword()` because "no password
 * set yet" is a state the staff account list reports and the login route has
 * to spend equal time on — neither can ask by submitting a password.
 * @param stored The value of the account's `password_hash` column.
 */
export function isPasswordHashUsable(stored: string): boolean {
  return parseStoredHash(stored) !== null;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (!parsed) return false;
  const bits = await deriveBits(password, fromHex(parsed.salt));
  return timingSafeEqualHex(toHex(bits), parsed.hash);
}
