import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {sign} from 'hono/jwt';
import {setCookie} from 'hono/cookie';
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

interface ParticipantRow {
  id: string;
  password_hash: string;
  password_changed_at: string;
}

export const participantAuthRoute = new Hono<Env>().post(
  '/login',
  zValidator('json', ParticipantLoginInputSchema),
  async c => {
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
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
    return c.json({ok: true});
  },
);
