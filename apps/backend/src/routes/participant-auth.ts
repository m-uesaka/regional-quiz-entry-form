import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {sign} from 'hono/jwt';
import {setCookie} from 'hono/cookie';
import {
  ParticipantLoginInputSchema,
  type ParticipantLoginInput,
} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {createDbClient} from '../lib/db';
import {verifyPassword} from '../lib/password';
import {clientIp, emailKey, rateLimit} from '../middleware/rate-limit';
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

// The period both login limiters count over (`wrangler.toml`), which is
// also how long a refused caller is asked to wait.
const LOGIN_LIMIT_PERIOD_SECONDS = 60;

export const participantAuthRoute = new Hono<Env>().post(
  '/login',
  // Two limits, because they stop different attacks: one address trying many
  // accounts is only visible on the IP key, and many addresses trying one
  // account only on the email key. Neither alone covers the other, and they
  // sit on separate limiters because the per-account one has to be far
  // looser -- see `types/env.ts`.
  //
  // The IP key deliberately carries no endpoint of its own, so the staff
  // login below shares this bucket: what it caps is one caller's PBKDF2
  // spend, and that is the same CPU whichever of the two they aim at.
  rateLimit(
    env => env.LOGIN_IP_RATE_LIMITER,
    c => `ip:${clientIp(c)}`,
    LOGIN_LIMIT_PERIOD_SECONDS,
  ),
  zValidator('json', ParticipantLoginInputSchema),
  // After the validator, so the address counted against is one the schema
  // has already accepted rather than any string a caller cares to send.
  //
  // Named by endpoint, unlike the IP key: a participant and a staff member
  // can hold the same address, and without the prefix this cheap
  // unauthenticated endpoint could be used to spend that address's staff
  // budget.
  rateLimit<{out: {json: ParticipantLoginInput}}>(
    env => env.LOGIN_EMAIL_RATE_LIMITER,
    c => `participant-login:${emailKey(c.req.valid('json').email)}`,
    LOGIN_LIMIT_PERIOD_SECONDS,
  ),
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
