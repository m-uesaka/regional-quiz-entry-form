// Password hashing: PBKDF2-HMAC-SHA256 with a 128-bit random salt and a
// 256-bit output, via Web Crypto.
//
// Stored format: `pbkdf2-sha256$<iterations>$<saltHex>$<hashHex>`. Every hash
// carries its own algorithm and iteration count, so the parameters new hashes
// are made with can change without locking anyone out: an existing hash is
// still verified with the count it was made with, and `verifyPassword()` then
// reports `needsRehash` so the login that just proved the password can
// rewrite it with the current parameters (see `lib/password-rehash.ts`).
// Values without a `$` are the format this one replaced, `<saltHex>:<hashHex>`
// at 100,000 iterations, and are read as exactly that.
//
// Why the count is still 100,000, below OWASP's 600,000 for PBKDF2-SHA256:
// Cloudflare Workers refuses more. Measured on 2026-10-23 with a throwaway
// Worker calling `crypto.subtle.deriveBits()` (PBKDF2, SHA-256, 256 bits):
//
// - On Cloudflare's edge (`wrangler dev --remote`, compatibility date
//   2026-08-01): 100,000 iterations succeed; 100,001 and 600,000 both throw
//   `NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
//   supported (requested 100001).`
// - In local workerd (`wrangler dev --local`, workerd 1.20250718 and
//   1.20260820) there is no cap at all: 600,000 succeeds. The limit lives in
//   the runtime's `LimitEnforcer` (`DEFAULT_MAX_PBKDF2_ITERATIONS` in
//   cloudflare/workerd `src/workerd/io/limit-enforcer.h`), which standalone
//   workerd overrides to "no limit". Neither local dev nor Bun's tests can
//   catch a count above the cap -- it only fails once deployed, and then on
//   every login and every new account -- so do not raise
//   `PBKDF2_ITERATIONS` past 100,000 while this runs on Workers.
//
// Cost at 100,000 iterations: about 17 ms per hash on the edge (ten
// derivations in one request took ~170 ms more than ten 1-iteration ones),
// about 18-19 ms in local workerd, for a 20-character password; a
// 256-character one adds ~1 ms (input length only matters for the first HMAC
// key setup). Login and entry creation each pay this once.
//
// Ways past the cap, each of which only needs a new `ALGORITHM` branch here
// (old hashes keep verifying and are rehashed on the next login):
//
// - scrypt through `node:crypto` (`nodejs_compat`): workerd implements it
//   natively, capped at N*r*p <= 2^20 (`DEFAULT_MAX_SCRYPT_COST`), which
//   admits OWASP's N=2^17, r=8, p=1. Memory-hard, so it is the stronger
//   choice; it needs the compatibility flag and a measurement of its own.
// - A pure-JS PBKDF2 (or an Argon2/scrypt WASM build) is not subject to the
//   cap, but is a dependency to vet and runs slower per iteration than the
//   native one, so a given CPU budget buys less work. (Chaining several
//   `deriveBits()` calls is not an option: the result is not PBKDF2, and
//   each call restarts the HMAC chain.)
// - Hashing outside the Worker (a Supabase function, a separate service)
//   moves the cost but adds a network hop and a secret to every login.

const ALGORITHM = 'pbkdf2-sha256';
// What new hashes are made with. Raising it is safe for existing accounts
// (see above), but read the Workers cap first.
const PBKDF2_ITERATIONS = 100_000;
// What a value in the pre-`$` `salt:hash` format was made with.
const LEGACY_PBKDF2_ITERATIONS = 100_000;
// A sanity bound on a stored count, not a policy: a corrupted or hostile
// value must not be able to make a single login spin for minutes.
const MAX_STORED_ITERATIONS = 10_000_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const SALT_HEX_LENGTH = SALT_BYTES * 2;
const HASH_HEX_LENGTH = (HASH_BITS / 8) * 2;
const HEX_PATTERN = /^[0-9a-f]+$/i;
// A positive decimal integer with no sign, leading zero, exponent or
// fraction -- the only spelling `hashPassword()` writes, so anything else in
// the column is corruption rather than a value to coax into a number.
const ITERATIONS_PATTERN = /^[1-9][0-9]*$/;

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
  iterations: number,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  return crypto.subtle.deriveBits(
    {name: 'PBKDF2', salt, iterations, hash: 'SHA-256'},
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

function formatStoredHash(
  iterations: number,
  saltHex: string,
  hashHex: string,
): string {
  return `${ALGORITHM}$${iterations}$${saltHex}$${hashHex}`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const bits = await deriveBits(password, salt, PBKDF2_ITERATIONS);
  return formatStoredHash(PBKDF2_ITERATIONS, toHex(salt.buffer), toHex(bits));
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
 * A well-formed hash no password matches, for a login to verify against when
 * no account matches the address, so that an unknown address costs the same
 * PBKDF2 work as a wrong password and can't be timed to enumerate accounts.
 *
 * Built from the current parameters rather than spelled out, so it costs
 * what a freshly hashed password costs whenever `PBKDF2_ITERATIONS` moves.
 * (Accounts still on an older, cheaper hash are distinguishable by time
 * until their next login rehashes them; that window closes on its own.)
 * An all-zero output is not one PBKDF2 can be expected to produce.
 */
export const DUMMY_PASSWORD_HASH = formatStoredHash(
  PBKDF2_ITERATIONS,
  '00'.repeat(SALT_BYTES),
  '00'.repeat(HASH_BITS / 8),
);

interface ParsedHash {
  iterations: number;
  saltHex: string;
  hashHex: string;
  /** Written in the pre-`$` `salt:hash` format. */
  legacy: boolean;
}

function isSaltAndHash(saltHex: string, hashHex: string): boolean {
  return (
    saltHex.length === SALT_HEX_LENGTH &&
    hashHex.length === HASH_HEX_LENGTH &&
    HEX_PATTERN.test(saltHex) &&
    HEX_PATTERN.test(hashHex)
  );
}

/**
 * Reads a stored hash in either format, or null if `stored` is not one
 * `hashPassword()` produces (or once produced). An unknown algorithm is null
 * too: verifying it as PBKDF2 would only ever fail, and doing so quietly
 * would hide a value this code doesn't understand.
 * @param stored The value of the account's `password_hash` column.
 */
function parseStoredHash(stored: string): ParsedHash | null {
  if (!stored.includes('$')) {
    const parts = stored.split(':');
    if (parts.length !== 2) return null;
    const [saltHex, hashHex] = parts;
    if (!isSaltAndHash(saltHex, hashHex)) return null;
    return {
      iterations: LEGACY_PBKDF2_ITERATIONS,
      saltHex,
      hashHex,
      legacy: true,
    };
  }
  const parts = stored.split('$');
  if (parts.length !== 4) return null;
  const [algorithm, iterationsText, saltHex, hashHex] = parts;
  if (algorithm !== ALGORITHM) return null;
  if (!ITERATIONS_PATTERN.test(iterationsText)) return null;
  const iterations = Number(iterationsText);
  if (iterations > MAX_STORED_ITERATIONS) return null;
  if (!isSaltAndHash(saltHex, hashHex)) return null;
  return {iterations, saltHex, hashHex, legacy: false};
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

/** What `verifyPassword()` found. */
export interface PasswordVerification {
  valid: boolean;
  /**
   * The password matched a hash made with older parameters (or in the older
   * format) than `hashPassword()` now uses, and the caller -- who holds the
   * plaintext only at this moment -- should store a fresh hash of it. Never
   * true when `valid` is false.
   */
  needsRehash: boolean;
}

/**
 * Checks `password` against a stored hash in either format.
 * @param password The submitted password.
 * @param stored The value of the account's `password_hash` column.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<PasswordVerification> {
  const parsed = parseStoredHash(stored);
  if (!parsed) return {valid: false, needsRehash: false};
  const bits = await deriveBits(
    password,
    fromHex(parsed.saltHex),
    parsed.iterations,
  );
  // Lowercased because `toHex()` writes lowercase and the stored value is
  // accepted in either case.
  const valid = timingSafeEqualHex(toHex(bits), parsed.hashHex.toLowerCase());
  return {
    valid,
    needsRehash:
      valid && (parsed.legacy || parsed.iterations < PBKDF2_ITERATIONS),
  };
}
