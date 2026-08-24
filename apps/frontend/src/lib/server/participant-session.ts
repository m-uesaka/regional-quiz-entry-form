import {verify} from 'hono/jwt';
import {
  ParticipantClaimsSchema,
  type ParticipantClaims,
} from '@regional-quiz/shared';

/**
 * Verifies and parses the `participant_session` JWT issued by the backend
 * on participant login. Mirrors
 * `apps/backend/src/middleware/participant-auth.ts`'s private
 * `readParticipantId()` so the frontend recognizes the same session cookie
 * the backend does.
 *
 * @param token The raw `participant_session` cookie value, if present.
 * @param secret The `SESSION_SECRET` used to sign the token. May be
 *     `undefined` outside a real Cloudflare context (e.g. local `vite dev`
 *     or tests), in which case this always resolves to `null`.
 * @return The parsed claims, or `null` if the token is missing, invalid,
 *     expired, or doesn't match the expected shape.
 */
export async function readParticipantClaims(
  token: string | undefined,
  secret: string | undefined,
): Promise<ParticipantClaims | null> {
  if (!token || !secret) return null;
  try {
    const payload = await verify(token, secret, 'HS256');
    // hono/jwt's `verify()` only checks expiration when an `exp` claim is
    // present, so a correctly signed token without one would otherwise be
    // treated as a valid session indefinitely.
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as Record<string, unknown>).exp !== 'number'
    ) {
      return null;
    }
    return ParticipantClaimsSchema.parse(payload);
  } catch {
    // Covers both an invalid/expired signature (thrown by `verify`) and
    // claims that don't match the expected shape (thrown by `.parse`).
    return null;
  }
}
