const TOKEN_BYTES = 32;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Generates a high-entropy, URL-safe opaque token for one-time links. */
export function generateToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/**
 * Hashes a token for storage/lookup, so the raw token (which is only ever
 * sent to the recipient's mailbox) never has to be kept at rest.
 * @param token The raw token, as returned by `generateToken()`.
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return toHex(new Uint8Array(digest));
}
