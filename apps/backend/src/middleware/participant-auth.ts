import {createMiddleware} from 'hono/factory';
import {getCookie} from 'hono/cookie';
import {verify} from 'hono/jwt';
import {
  ParticipantClaimsSchema,
  type ParticipantClaims,
} from '@regional-quiz/shared';
import type {ParticipantEnv} from '../types/env';
import {createDbClient} from '../lib/db';

export const PARTICIPANT_SESSION_COOKIE = 'participant_session';

interface ParticipantSessionRow {
  password_changed_at: string;
  email_verified_at: string | null;
}

async function readParticipantClaims(
  token: string | undefined,
  secret: string,
): Promise<ParticipantClaims | null> {
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
    return ParticipantClaimsSchema.parse(payload);
  } catch {
    // Covers both an invalid/expired signature (thrown by `verify`) and
    // claims that don't match the expected shape (thrown by `.parse`).
    return null;
  }
}

export function requireParticipant() {
  return createMiddleware<ParticipantEnv>(async (c, next) => {
    const claims = await readParticipantClaims(
      getCookie(c, PARTICIPANT_SESSION_COOKIE),
      c.env.SESSION_SECRET,
    );
    if (!claims) {
      return c.json({error: 'unauthorized'}, 401);
    }

    // The signature alone can't tell whether this session was cut short: it
    // is stateless and lives for a week, so a password reset in the meantime
    // is only visible in `participants.password_changed_at`. Without this
    // read, a stolen cookie would keep working for the rest of its TTL even
    // after the participant reset their password to lock the thief out.
    const db = createDbClient(c.env);
    const {data: participant, error} = await db
      .from('participants')
      .select('password_changed_at, email_verified_at')
      .eq('id', claims.sub)
      .returns<ParticipantSessionRow[]>()
      .maybeSingle();
    if (error) {
      // Not a 401: the session may well be fine and we simply couldn't check
      // it, and answering "unauthorized" would send the participant off to
      // log in again over a database outage.
      console.error('failed to check the session against the participant', {
        error: error.message,
      });
      return c.json({error: 'internal server error'}, 500);
    }
    // A missing row means the participant was deleted after the cookie was
    // issued, which is as much a dead session as a reset one. Otherwise the
    // session is current exactly when it still names the password that is on
    // the row now -- an equality between two readings of the same column,
    // rather than an "issued before?" comparison that would need the Worker's
    // clock to agree with Postgres'. An unparseable timestamp yields `NaN`,
    // which compares unequal to everything and so fails closed.
    //
    // An unverified account is refused too. The login no longer issues a
    // session for one, but sessions issued before migration 0034 (#189)
    // may still name one -- possibly held by someone who registered another
    // person's address -- and must not outlive the change.
    if (
      !participant ||
      !participant.email_verified_at ||
      Date.parse(participant.password_changed_at) !== claims.pwdChangedAt
    ) {
      return c.json({error: 'unauthorized'}, 401);
    }

    c.set('participantId', claims.sub);
    await next();
  });
}
