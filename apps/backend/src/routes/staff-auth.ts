import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {sign} from 'hono/jwt';
import {setCookie} from 'hono/cookie';
import {
  StaffLoginInputSchema,
  type StaffClaims,
  type StaffRole,
  type TournamentType,
} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {createDbClient} from '../lib/db';
import {verifyPassword} from '../lib/password';
import {STAFF_SESSION_COOKIE} from '../middleware/staff-auth';

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
}

export const staffAuthRoute = new Hono<Env>().post(
  '/login',
  zValidator('json', StaffLoginInputSchema),
  async c => {
    const {email, password} = c.req.valid('json');
    const db = createDbClient(c.env);
    const {data: staff, error} = await db
      .from('staff_accounts')
      .select('id, password_hash, role, region_id, tournament_type')
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
    return c.json({ok: true, role: staff.role});
  },
);
