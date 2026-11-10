import {Hono} from 'hono';
import {
  StaffAccountCreateInputSchema,
  type StaffAccount,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {type Tables} from '../lib/db';
import {UnexpectedFailure, unwrap} from '../lib/errors';
import {isPasswordHashUsable, UNUSABLE_PASSWORD_HASH} from '../lib/password';
import {
  badRequest,
  duplicate,
  FOREIGN_KEY_VIOLATION_SQLSTATE,
  LAST_GENERAL_STAFF_SQLSTATE,
  mapPgError,
  type PgErrorTable,
  STAFF_ACCOUNT_NOT_FOUND_SQLSTATE,
  UNIQUE_VIOLATION_SQLSTATE,
} from '../lib/pg-errors';
import {sendStaffPasswordLink} from '../lib/staff-password-reset';
import {IdParamSchema} from './params';
import {validate} from '../middleware/validate';

/**
 * What disabling or enabling answers when `disable_staff_account()` /
 * `enable_staff_account()` find no account with the id. The frontend matches
 * the message.
 */
const STAFF_ACCOUNT_NOT_FOUND_ERRORS = {
  [STAFF_ACCOUNT_NOT_FOUND_SQLSTATE]: {
    status: 404,
    error: 'staff account not found',
  },
} as const satisfies PgErrorTable<404>;

const STAFF_ACCOUNT_COLUMNS = `
  id, email, password_hash, role, region_id, tournament_type,
  disabled_at, regions(slug, name)
`;

/** Shape of a `staff_accounts` row as selected above. */
interface StaffAccountRow extends Pick<
  Tables<'staff_accounts'>,
  | 'id'
  | 'email'
  | 'password_hash'
  | 'role'
  | 'region_id'
  | 'tournament_type'
  | 'disabled_at'
> {
  // The joined `regions` row, null for `general` staff, who have no region.
  regions: Pick<Tables<'regions'>, 'slug' | 'name'> | null;
}

// `password_hash` is read but never carried across: the list reports only
// *whether* a password has been set (an account whose invite is still
// outstanding carries `UNUSABLE_PASSWORD_HASH`, which no password matches),
// so the admin screen can tell a working account from one that still needs
// its link re-sent without the hash itself ever leaving the Worker.
function rowToStaffAccount(row: StaffAccountRow): StaffAccount {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    regionId: row.region_id,
    regionSlug: row.regions?.slug ?? null,
    regionName: row.regions?.name ?? null,
    tournamentType: row.tournament_type,
    passwordSet: isPasswordHashUsable(row.password_hash),
    disabledAt: row.disabled_at,
  };
}

// The guard is attached per route rather than as `.use('*', ...)`, unlike
// `routes/regions.ts`. Hono matches middleware on the request's final path,
// not on the sub-app it was registered in, and this sub-app shares its
// `/staff` mount with `routes/staff-entries.ts` and `routes/staff-mail.ts` —
// a wildcard here would lock regional staff out of their own entry lists.
export const staffAccountsRoute = new Hono<StaffEnv>()
  .get('/accounts', requireGeneralStaff(), async c => {
    const db = c.get('db');
    const data = unwrap(
      await db
        .from('staff_accounts')
        .select(STAFF_ACCOUNT_COLUMNS)
        .order('created_at', {ascending: true}),
      'failed to read the staff accounts',
    );
    return c.json(data.map(rowToStaffAccount));
  })
  .post(
    '/accounts',
    requireGeneralStaff(),
    validate('json', StaffAccountCreateInputSchema),
    async c => {
      const input = c.req.valid('json');
      const db = c.get('db');
      // The initial password is never chosen here and never travels back in
      // the response: the row is created with a hash nothing can match, and
      // the account's own owner sets a real one from the mailed link. That
      // keeps the general staff member who created the account from ever
      // knowing the regional staff member's password.
      const {data, error} = await db
        .from('staff_accounts')
        .insert({
          email: input.email,
          password_hash: UNUSABLE_PASSWORD_HASH,
          role: input.role,
          region_id: input.role === 'regional' ? input.regionId : null,
          tournament_type:
            input.role === 'regional' ? input.tournamentType : null,
        })
        .select(STAFF_ACCOUNT_COLUMNS)
        .single();
      if (error) {
        // The unique violation is the one on (`email`, `tournament_type`)
        // (#166): the address already has a regional account of this type,
        // or -- for a general invite -- a general one. A regional and a
        // general account never clash, their types differ. The foreign key
        // violation is `region_id` naming no region. Both are input
        // mistakes the staff member can fix from the form they just
        // submitted, so they get an answer they can act on rather than a
        // 500.
        //
        // Everything left — including 23514, the role/scope check constraint,
        // which `StaffAccountCreateInputSchema` has already made
        // unrepresentable — is server-side.
        const {body, status} = mapPgError(
          error,
          {
            [UNIQUE_VIOLATION_SQLSTATE]: duplicate('email already in use'),
            [FOREIGN_KEY_VIOLATION_SQLSTATE]: badRequest('unknown region'),
          },
          'failed to create the staff account',
        );
        return c.json(body, status);
      }

      const account = rowToStaffAccount(data);
      const mailResult = await sendStaffPasswordLink(
        c.env,
        c.get('db'),
        account.id,
        account.email,
      );
      if (!mailResult.ok) {
        // Unlike the participant reset (which hands the whole thing to
        // `waitUntil()` so it can't be timed), this is awaited and reported:
        // the account exists but is unusable until its owner follows a link
        // that never went out, and the staff member who created it is the one
        // who has to re-send it. The body says so rather than answering the
        // generic "internal server error", so the admin screen doesn't send
        // them back to a create form that would now answer 409.
        console.error('failed to send the staff password setup mail', {
          staffAccountId: account.id,
          error: mailResult.error,
        });
        return c.json(
          {error: 'account created but the setup mail could not be sent'},
          500,
        );
      }
      return c.json(account, 201);
    },
  )
  .post(
    '/accounts/:id/password-reset',
    requireGeneralStaff(),
    validate('param', IdParamSchema),
    async c => {
      const db = c.get('db');
      // The address is read from the row rather than taken from the request:
      // a reset link must only ever go to the account's own mailbox, so there
      // is nothing for the caller to supply.
      const account = unwrap(
        await db
          .from('staff_accounts')
          .select('id, email')
          .eq('id', c.req.valid('param').id)
          .maybeSingle(),
        'failed to read the staff account to reset',
      );
      if (!account) {
        return c.json({error: 'staff account not found'}, 404);
      }

      const mailResult = await sendStaffPasswordLink(
        c.env,
        c.get('db'),
        account.id,
        account.email,
      );
      if (!mailResult.ok) {
        // A disabled account is refused a link rather than mailed one that
        // `reset_staff_password()` would refuse in turn: the general staff
        // member is told why here, while the link's holder would only see
        // an "invalid or expired" page. Enabling the account comes first.
        // The refusal comes from `issue_staff_password_link()`, under the
        // account's lock, so a disable racing this request can't slip a
        // link past it.
        if (mailResult.disabled) {
          return c.json({error: 'staff account disabled'}, 409);
        }
        throw new UnexpectedFailure(
          'failed to send the staff password reset mail',
          mailResult.error,
        );
      }
      return c.json({ok: true});
    },
  )
  // Ends every session the account has open, wherever it was opened: the
  // guards in `middleware/staff-auth.ts` compare each session's
  // `sessionsValidFrom` claim against this column on every request, so
  // moving it makes every cookie issued before refuse with 401 from the next
  // request on. This is the only way to cut a staff JWT short, e.g. for a
  // cookie copied off a lost laptop. It doesn't touch the password, so
  // anyone who knows it can log straight back in: it doesn't lock out
  // someone stepping down, or a password that leaked along with the cookie
  // (that is what `/accounts/:id/disable` below is for).
  //
  // The caller may name their own account. That is deliberate (a staff
  // member who lost a device can cut its session themselves), and it ends
  // the caller's own session too: the request that does it still answers
  // 200, the one after it 401s.
  .post(
    '/accounts/:id/revoke-sessions',
    requireGeneralStaff(),
    validate('param', IdParamSchema),
    async c => {
      const db = c.get('db');
      // The new value comes from the Worker's clock rather than Postgres'
      // `now()`, which an update through PostgREST can't name. That is safe
      // because nothing compares it with a clock: a session is current only
      // if its claim *equals* the column, so all that matters is that the
      // value changes, and a fresh millisecond timestamp does.
      const account = unwrap(
        await db
          .from('staff_accounts')
          .update({sessions_valid_from: new Date().toISOString()})
          .eq('id', c.req.valid('param').id)
          .select('id')
          .maybeSingle(),
        'failed to revoke the staff sessions',
      );
      if (!account) {
        return c.json({error: 'staff account not found'}, 404);
      }
      return c.json({ok: true});
    },
  )
  // Shuts an account out (#156): it can no longer log in, every session it
  // has open ends, and its outstanding password links are deleted. Unlike
  // `revoke-sessions`, knowing the password no longer helps, which is what
  // someone stepping down -- or a password that leaked -- calls for.
  //
  // Disabling rather than deleting keeps the row, its password and the
  // record of who covered which tournament, and `/enable` undoes it. Nothing
  // else in the schema references a staff account, so a deletion would have
  // been possible, but not reversible.
  //
  // The caller may not name their own account: a general staff member who
  // locked themselves out could only be let back in by another one, and if
  // they were the last, by no one. `disable_staff_account()` refuses the
  // last enabled general account as well, which also covers two general
  // staff disabling each other at the same moment.
  .post(
    '/accounts/:id/disable',
    requireGeneralStaff(),
    validate('param', IdParamSchema),
    async c => {
      // Lowercased before comparing: the param schema and Postgres both
      // accept a UUID in either case, while the claim is always lowercase,
      // so `/ABC.../disable` would otherwise slip past this check.
      const id = c.req.valid('param').id.toLowerCase();
      if (id === c.get('staff').sub.toLowerCase()) {
        return c.json({error: 'cannot disable your own account'}, 409);
      }
      const {error} = await c.get('db').rpc('disable_staff_account', {
        p_staff_account_id: id,
      });
      if (error) {
        const {body, status} = mapPgError(
          error,
          {
            ...STAFF_ACCOUNT_NOT_FOUND_ERRORS,
            [LAST_GENERAL_STAFF_SQLSTATE]: {
              status: 409,
              error: 'cannot disable the last general staff account',
            },
          },
          'failed to disable the staff account',
        );
        return c.json(body, status);
      }
      return c.json({ok: true});
    },
  )
  // Lets a disabled account log in again with the password it already had.
  // Its sessions stay ended: disabling moved `sessions_valid_from`, and
  // nothing here moves it back, so the owner logs in afresh.
  //
  // `enable_staff_account()` also drops any password link the account
  // holds, in the same transaction as the update. A link written while the
  // account was disabled is refused for as long as it stays so, and must
  // not come back to life now -- the account may have been disabled
  // precisely because its mailbox was compromised. A fresh link can be sent
  // once it is enabled. An account that is already enabled is left alone,
  // links included, so a 有効化 pressed on a stale screen doesn't throw
  // away a link another general staff member has just sent.
  .post(
    '/accounts/:id/enable',
    requireGeneralStaff(),
    validate('param', IdParamSchema),
    async c => {
      const {error} = await c.get('db').rpc('enable_staff_account', {
        p_staff_account_id: c.req.valid('param').id,
      });
      if (error) {
        const {body, status} = mapPgError(
          error,
          {
            ...STAFF_ACCOUNT_NOT_FOUND_ERRORS,
          },
          'failed to enable the staff account',
        );
        return c.json(body, status);
      }
      return c.json({ok: true});
    },
  );
