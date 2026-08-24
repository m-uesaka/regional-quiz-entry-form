import {createMiddleware} from 'hono/factory';
import {getCookie} from 'hono/cookie';
import {verify} from 'hono/jwt';
import {ParticipantClaimsSchema} from '@regional-quiz/shared';
import type {ParticipantEnv} from '../types/env';

export const PARTICIPANT_SESSION_COOKIE = 'participant_session';

async function readParticipantId(
  token: string | undefined,
  secret: string,
): Promise<string | null> {
  if (!token) return null;
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
    return ParticipantClaimsSchema.parse(payload).sub;
  } catch {
    // Covers both an invalid/expired signature (thrown by `verify`) and
    // claims that don't match the expected shape (thrown by `.parse`).
    return null;
  }
}

export function requireParticipant() {
  return createMiddleware<ParticipantEnv>(async (c, next) => {
    const participantId = await readParticipantId(
      getCookie(c, PARTICIPANT_SESSION_COOKIE),
      c.env.SESSION_SECRET,
    );
    if (!participantId) {
      return c.json({error: 'unauthorized'}, 401);
    }
    c.set('participantId', participantId);
    await next();
  });
}
