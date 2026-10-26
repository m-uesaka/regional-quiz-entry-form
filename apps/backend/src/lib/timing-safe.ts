/**
 * Compares two strings in constant time for strings of the same length, so
 * how long a refusal takes can't be timed to learn how many leading
 * characters matched. Only the length can leak, which says nothing useful
 * about a hash or a randomly generated secret.
 *
 * Shared by the password check (`lib/password.ts`) and the forwarded
 * client-IP secret (`middleware/rate-limit.ts`), so a fix to one reaches
 * both.
 * @param a One string.
 * @param b The other.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
