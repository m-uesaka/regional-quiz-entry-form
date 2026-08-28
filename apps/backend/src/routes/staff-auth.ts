import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {sign} from 'hono/jwt';
import {setCookie} from 'hono/cookie';
import {
  StaffLoginInputSchema,
  StaffPasswordResetConfirmInputSchema,
  type StaffClaims,
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
  })
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
  );
