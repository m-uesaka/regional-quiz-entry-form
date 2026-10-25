import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {sign} from 'hono/jwt';
import {deleteCookie, setCookie} from 'hono/cookie';
import {
  StaffLoginInputSchema,
  type StaffClaims,
  type StaffLoginInput,
  type StaffLoginResponse,
  type StaffRole,
  type TournamentType,
} from '@regional-quiz/shared';
import {StaffPasswordResetConfirmInputSchema} from '@regional-quiz/shared/password-policy';
import type {Env} from '../types/env';
import {createDbClient} from '../lib/db';
import {verifyAccountPassword} from '../lib/password-rehash';
import {internalError} from '../lib/errors';
import {confirmStaffPasswordReset} from '../lib/staff-password-reset';
import {STAFF_SESSION_COOKIE} from '../middleware/staff-auth';
import {clientIp, emailKey, rateLimit} from '../middleware/rate-limit';

const SESSION_TTL_SECONDS = 60 * 60 * 12;
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
  sessions_valid_from: string;
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
      const {email, scope, password} = c.req.valid('json');
      const db = createDbClient(c.env);
      // The address alone may name two accounts -- a region's 最強位 and
      // 新人王 run from one mailbox (#166) -- so `scope` picks the one: a
      // tournament type for regional staff, or none at all for general
      // staff, whose rows carry a null type. The unique constraint on
      // (email, tournament_type) leaves at most one row either way.
      //
      // A disabled account (#156) is simply not looked for, so it gets the
      // same 401 -- after the same PBKDF2 work -- as an address that was
      // never registered: whoever holds its password learns nothing from
      // trying it.
      const query = db
        .from('staff_accounts')
        .select(
          'id, password_hash, role, region_id, tournament_type, ' +
            'sessions_valid_from, regions(slug)',
        )
        .eq('email', email)
        .is('disabled_at', null);
      const {data: staff, error} = await (
        scope === 'general'
          ? query.is('tournament_type', null)
          : query.eq('tournament_type', scope)
      )
        .returns<StaffAccountRow[]>()
        .maybeSingle();

      if (error) {
        return c.json({error: 'internal server error'}, 500);
      }

      // An account created by `POST /api/staff/accounts` whose owner hasn't
      // followed their invite link yet carries an unusable placeholder hash,
      // which costs the same PBKDF2 work as a wrong password so "invited, not
      // set up yet" can't be told apart by response time: see
      // `verifyAccountPassword()`, which also moves an older hash to the
      // current parameters after the response.
      const valid = await verifyAccountPassword(
        c.env,
        'staff_accounts',
        staff,
        password,
        upgrade => c.executionCtx.waitUntil(upgrade),
      );
      if (!staff || !valid) {
        return c.json({error: 'invalid credentials'}, 401);
      }

      const claims: StaffClaims = {
        sub: staff.id,
        role: staff.role,
        regionId: staff.region_id,
        tournamentType: staff.tournament_type,
        // Which generation of this account's sessions the new one belongs
        // to, so that moving `sessions_valid_from` later can cut it (see
        // `isSessionCurrent()` in `middleware/staff-auth.ts`). Read in the
        // same query as the password hash, so it costs no extra round trip.
        sessionsValidFrom: Date.parse(staff.sessions_valid_from),
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
    // of its 12 hours unless a general staff member revokes the account's
    // sessions (`POST /api/staff/accounts/:id/revoke-sessions`), which is
    // deliberately a separate, explicit act: logging out of one browser
    // shouldn't log the same person out of every other one.
    deleteCookie(c, STAFF_SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
    return c.json({ok: true});
  });
