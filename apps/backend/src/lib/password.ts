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

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [saltHex, hashHex] = parts;
  if (
    saltHex.length !== SALT_HEX_LENGTH ||
    hashHex.length !== HASH_HEX_LENGTH ||
    !HEX_PATTERN.test(saltHex) ||
    !HEX_PATTERN.test(hashHex)
  ) {
    return false;
  }
  const bits = await deriveBits(password, fromHex(saltHex));
  return timingSafeEqualHex(toHex(bits), hashHex);
}
