import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {sign} from 'hono/jwt';
import {deleteCookie, setCookie} from 'hono/cookie';
import {
  StaffLoginInputSchema,
  StaffPasswordResetConfirmInputSchema,
  type StaffClaims,
  type StaffLoginInput,
  type StaffLoginResponse,
  type StaffRole,
  type TournamentType,
} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {createDbClient} from '../lib/db';
import {isPasswordHashUsable, verifyPassword} from '../lib/password';
import {internalError} from '../lib/errors';
import {confirmStaffPasswordReset} from '../lib/staff-password-reset';
import {STAFF_SESSION_COOKIE} from '../middleware/staff-auth';
import {clientIp, emailKey, rateLimit} from '../middleware/rate-limit';

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

// Matches the period both login limiters count over (`wrangler.toml`).
const LOGIN_LIMIT_PERIOD_SECONDS = 60;

export const staffAuthRoute = new Hono<Env>()
  .post(
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
      c => `staff-login:${emailKey(c.req.valid('json').email)}`,
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

      // An account created by `POST /api/staff/accounts` whose owner hasn't
      // followed their invite link yet carries an unusable placeholder hash.
      // `verifyPassword()` refuses it either way, but it refuses it before
      // doing any PBKDF2 work, which would make "invited, not set up yet"
      // distinguishable from "wrong password" by response time -- the same leak
      // the dummy hash exists to close for an unknown email.
      const storedHash =
        staff && isPasswordHashUsable(staff.password_hash)
          ? staff.password_hash
          : DUMMY_PASSWORD_HASH;
      const passwordValid = await verifyPassword(password, storedHash);
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
    },
  )
  // The counterpart to the invite mail `POST /api/staff/accounts` sends, and
  // to the link a general staff member re-issues from
  // `/api/staff/accounts/:id/password-reset`. There is no `/request` sibling:
  // staff links are always issued by a general staff member for a named
  // account, so this endpoint never has to take an address -- and can't be
  // used to find out which ones are registered.
  .post(
    '/password-reset/confirm',
    zValidator('json', StaffPasswordResetConfirmInputSchema),
    async c => {
      const result = await confirmStaffPasswordReset(
        c.env,
        c.req.valid('json'),
      );
      if (!result.ok) {
        if (result.status === 500) {
          return c.json(
            internalError(
              'failed to confirm the staff password reset',
              result.error,
            ),
            500,
          );
        }
        return c.json({error: result.error}, result.status);
      }
      return c.json({ok: true});
    },
  )
  .post('/logout', c => {
    // Same shape as the participant logout, and for the same reasons: no
    // session is required, and dropping the cookie is all a stateless JWT
    // allows. A staff token copied off the machine stays valid for the rest
    // of its 12 hours; revoking that is Task 11-3.
    deleteCookie(c, STAFF_SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
    return c.json({ok: true});
  });
