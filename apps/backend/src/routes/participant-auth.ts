import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {sign} from 'hono/jwt';
import {deleteCookie, setCookie} from 'hono/cookie';
import {ParticipantLoginInputSchema} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {createDbClient} from '../lib/db';
import {verifyPassword} from '../lib/password';
import {PARTICIPANT_SESSION_COOKIE} from '../middleware/participant-auth';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
// A well-formed but unusable hash, run through `verifyPassword` when no
// account matches so that a missing email costs the same PBKDF2 work as a
// wrong password and can't be timed to enumerate participant emails.
const DUMMY_PASSWORD_HASH = `${'00'.repeat(16)}:${'00'.repeat(32)}`;
// The attributes the session cookie is issued under, shared with `/logout`
// so the two can't drift apart: a deletion whose `path` / `secure` /
// `sameSite` differ from the ones the cookie was set with addresses a
// different cookie as far as the browser is concerned, and the live session
// would outlive the logout.
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
} as const;

interface ParticipantRow {
  id: string;
  password_hash: string;
  password_changed_at: string;
}

export const participantAuthRoute = new Hono<Env>()
  .post('/login', zValidator('json', ParticipantLoginInputSchema), async c => {
    const {email, password} = c.req.valid('json');
    const db = createDbClient(c.env);
    const {data: participant, error} = await db
      .from('participants')
      .select('id, password_hash, password_changed_at')
      .eq('email', email)
      .returns<ParticipantRow[]>()
      .maybeSingle();

    if (error) {
      return c.json({error: 'internal server error'}, 500);
    }

    const passwordValid = await verifyPassword(
      password,
      participant?.password_hash ?? DUMMY_PASSWORD_HASH,
    );
    if (!participant || !passwordValid) {
      return c.json({error: 'invalid credentials'}, 401);
    }

    // `pwdChangedAt` records which password this session was issued for, so
    // that a later reset can cut it (see `middleware/participant-auth.ts`);
    // without it the session would outlive the reset by up to
    // `SESSION_TTL_SECONDS`. It costs nothing extra -- the column comes back
    // with the hash this login just verified.
    const issuedAt = Math.floor(Date.now() / 1000);
    const token = await sign(
      {
        sub: participant.id,
        pwdChangedAt: Date.parse(participant.password_changed_at),
        iat: issuedAt,
        exp: issuedAt + SESSION_TTL_SECONDS,
      },
      c.env.SESSION_SECRET,
    );
    setCookie(c, PARTICIPANT_SESSION_COOKIE, token, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: SESSION_TTL_SECONDS,
    });
    return c.json({ok: true});
  })
  .post('/logout', c => {
    // No session is required. Logging out twice, or from a browser whose
    // cookie has already expired, is not a failure worth a 401 -- and
    // answering one would only force the caller to branch on it before
    // doing the exact same thing.
    //
    // Dropping the cookie is the whole of it: the JWT is stateless, so a
    // token already copied off the machine stays valid until it expires.
    // Cutting that too needs a server-side generation to check the token
    // against, the way `participants.password_changed_at` already cuts
    // sessions issued before a password reset (see
    // `middleware/participant-auth.ts`); Task 11-3 is where that lands.
    deleteCookie(c, PARTICIPANT_SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
    return c.json({ok: true});
  });
