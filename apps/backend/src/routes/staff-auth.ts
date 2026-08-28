import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {sign} from 'hono/jwt';
import {deleteCookie, setCookie} from 'hono/cookie';
import {
  StaffLoginInputSchema,
  type StaffClaims,
  type StaffLoginResponse,
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
// The attributes the session cookie is issued under, shared with `/logout`
// so the two can't drift apart: a deletion whose `path` / `secure` /
// `sameSite` differ from the ones the cookie was set with addresses a
// different cookie as far as the browser is concerned, and the live session
// would outlive the logout.
//
// `path` is spelled out rather than left to `hono/cookie`, which already
// defaults it to `/`: the point of this object is that the deletion can be
// read off the same attributes as the issue, and an attribute that only
// exists as a library default is one a reader has to go and check.
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/',
} as const;

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

export const staffAuthRoute = new Hono<Env>()
  .post('/login', zValidator('json', StaffLoginInputSchema), async c => {
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
      ...SESSION_COOKIE_OPTIONS,
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
  })
  .post('/logout', c => {
    // Same shape as the participant logout, and for the same reasons: no
    // session is required, and dropping the cookie is all a stateless JWT
    // allows. A staff token copied off the machine stays valid for the rest
    // of its 12 hours; revoking that is Task 11-3.
    deleteCookie(c, STAFF_SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
    return c.json({ok: true});
  });
