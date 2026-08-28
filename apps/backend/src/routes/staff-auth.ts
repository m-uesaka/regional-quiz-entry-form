import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {sign} from 'hono/jwt';
import {setCookie} from 'hono/cookie';
import {
  StaffLoginInputSchema,
  type StaffClaims,
  type StaffLoginInput,
  type StaffLoginResponse,
  type StaffRole,
  type TournamentType,
} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {createDbClient} from '../lib/db';
import {verifyPassword} from '../lib/password';
import {STAFF_SESSION_COOKIE} from '../middleware/staff-auth';
import {clientIp, rateLimit} from '../middleware/rate-limit';

const SESSION_TTL_SECONDS = 60 * 60 * 12;
// A well-formed but unusable hash, run through `verifyPassword` when no
// account matches so that a missing email costs the same PBKDF2 work as a
// wrong password and can't be timed to enumerate staff emails.
const DUMMY_PASSWORD_HASH = `${'00'.repeat(16)}:${'00'.repeat(32)}`;

interface StaffAccountRow {
  id: string;
  password_hash: string;
  role: StaffRole;
  region_id: string | null;
  tournament_type: TournamentType | null;
  // The joined `regions` row, null for `general` staff (who have no
  // `region_id`). Only the slug is read: the staff screens are keyed by it.
  regions: {slug: string} | null;
}

// Matches the period both login limiters count over (`wrangler.toml`).
const LOGIN_LIMIT_PERIOD_SECONDS = 60;

export const staffAuthRoute = new Hono<Env>().post(
  '/login',
  // Keyed both ways for the same reason as the participant login, and the
  // email key named after this endpoint so the two cannot spend each
  // other's per-account budget: see `routes/participant-auth.ts`.
  rateLimit(
    env => env.LOGIN_IP_RATE_LIMITER,
    c => `ip:${clientIp(c)}`,
    LOGIN_LIMIT_PERIOD_SECONDS,
  ),
  zValidator('json', StaffLoginInputSchema),
  rateLimit<{out: {json: StaffLoginInput}}>(
    env => env.LOGIN_EMAIL_RATE_LIMITER,
    c => `staff-login:email:${c.req.valid('json').email}`,
    LOGIN_LIMIT_PERIOD_SECONDS,
  ),
  async c => {
    const {email, password} = c.req.valid('json');
    const db = createDbClient(c.env);
    const {data: staff, error} = await db
      .from('staff_accounts')
      .select(
        'id, password_hash, role, region_id, tournament_type, regions(slug)',
      )
      .eq('email', email)
      .returns<StaffAccountRow[]>()
      .maybeSingle();

    if (error) {
      return c.json({error: 'internal server error'}, 500);
    }

    const passwordValid = await verifyPassword(
      password,
      staff?.password_hash ?? DUMMY_PASSWORD_HASH,
    );
    if (!staff || !passwordValid) {
      return c.json({error: 'invalid credentials'}, 401);
    }

    const claims: StaffClaims = {
      sub: staff.id,
      role: staff.role,
      regionId: staff.region_id,
      tournamentType: staff.tournament_type,
    };
    const token = await sign(
      {
        ...claims,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
      },
      c.env.SESSION_SECRET,
    );
    setCookie(c, STAFF_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: SESSION_TTL_SECONDS,
    });
    // The scope travels back as a slug rather than the `regionId` the claims
    // carry so that the login screen can build the entry-list URL of a
    // regional account's own tournament without a second round trip.
    const body: StaffLoginResponse = {
      ok: true,
      role: staff.role,
      regionSlug: staff.regions?.slug ?? null,
      tournamentType: staff.tournament_type,
    };
    return c.json(body);
  },
);
