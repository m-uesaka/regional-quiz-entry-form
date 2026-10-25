import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  StaffAccountCreateInputSchema,
  type StaffAccount,
  type StaffRole,
  type TournamentType,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {createDbClient} from '../lib/db';
import {internalError} from '../lib/errors';
import {isPasswordHashUsable, UNUSABLE_PASSWORD_HASH} from '../lib/password';
import {sendStaffPasswordLink} from '../lib/staff-password-reset';

const StaffAccountIdParamSchema = z.object({id: z.string().uuid()});

const STAFF_ACCOUNT_COLUMNS =
  'id, email, password_hash, role, region_id, tournament_type, ' +
  'disabled_at, regions(slug, name)';

/**
 * The SQLSTATEs `disable_staff_account()` (defined by
 * `supabase/migrations/0026_staff_accounts_per_type_and_disable.sql`) raises
 * when the account doesn't exist, and when disabling it would leave no
 * general staff account enabled.
 */
const ACCOUNT_NOT_FOUND_SQLSTATE = 'P0002';
const LAST_GENERAL_STAFF_SQLSTATE = 'P0004';

/** Shape of a `staff_accounts` row as selected above. */
interface StaffAccountRow {
  id: string;
  email: string;
  password_hash: string;
  role: StaffRole;
  region_id: string | null;
  tournament_type: TournamentType | null;
  disabled_at: string | null;
  // The joined `regions` row, null for `general` staff, who have no region.
  regions: {slug: string; name: string} | null;
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
    const db = createDbClient(c.env);
    const {data, error} = await db
      .from('staff_accounts')
      .select(STAFF_ACCOUNT_COLUMNS)
      .order('created_at', {ascending: true})
      .returns<StaffAccountRow[]>();
    if (error) {
      return c.json(
        internalError('failed to read the staff accounts', error),
        500,
      );
    }
    return c.json(data.map(rowToStaffAccount));
  })
  .post(
    '/accounts',
    requireGeneralStaff(),
    zValidator('json', StaffAccountCreateInputSchema),
    async c => {
      const input = c.req.valid('json');
      const db = createDbClient(c.env);
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
        .returns<StaffAccountRow[]>()
        .single();
      if (error) {
        // 23505 is the unique violation on (`email`, `tournament_type`) --
        // the address already has an account of this type, or a general one
        // (#166) -- and 23503 the foreign key on `region_id`. Both are input
        // mistakes the staff member can fix from the form they just
        // submitted, so they get an answer they can act on rather than a
        // 500.
        if (error.code === '23505') {
          return c.json({error: 'email already in use'}, 409);
        }
        if (error.code === '23503') {
          return c.json({error: 'unknown region'}, 400);
        }
        // Everything left — including 23514, the role/scope check constraint,
        // which `StaffAccountCreateInputSchema` has already made
        // unrepresentable — is server-side.
        return c.json(
          internalError('failed to create the staff account', error),
          500,
        );
      }

      const account = rowToStaffAccount(data);
      const mailResult = await sendStaffPasswordLink(
        c.env,
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
    zValidator('param', StaffAccountIdParamSchema),
    async c => {
      const db = createDbClient(c.env);
      // The address is read from the row rather than taken from the request:
      // a reset link must only ever go to the account's own mailbox, so there
      // is nothing for the caller to supply.
      const {data: account, error} = await db
        .from('staff_accounts')
        .select('id, email, disabled_at')
        .eq('id', c.req.valid('param').id)
        .returns<
          Array<{id: string; email: string; disabled_at: string | null}>
        >()
        .maybeSingle();
      if (error) {
        return c.json(
          internalError('failed to read the staff account to reset', error),
          500,
        );
      }
      if (!account) {
        return c.json({error: 'staff account not found'}, 404);
      }
      // A disabled account is refused a link rather than mailed one that
      // `reset_staff_password()` would refuse in turn: the general staff
      // member is told why here, while the link's holder would only see an
      // "invalid or expired" page. Enabling the account comes first.
      if (account.disabled_at !== null) {
        return c.json({error: 'staff account disabled'}, 409);
      }

      const mailResult = await sendStaffPasswordLink(
        c.env,
        account.id,
        account.email,
      );
      if (!mailResult.ok) {
        return c.json(
          internalError(
            'failed to send the staff password reset mail',
            mailResult.error,
          ),
          500,
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
    zValidator('param', StaffAccountIdParamSchema),
    async c => {
      const db = createDbClient(c.env);
      // The new value comes from the Worker's clock rather than Postgres'
      // `now()`, which an update through PostgREST can't name. That is safe
      // because nothing compares it with a clock: a session is current only
      // if its claim *equals* the column, so all that matters is that the
      // value changes, and a fresh millisecond timestamp does.
      const {data: account, error} = await db
        .from('staff_accounts')
        .update({sessions_valid_from: new Date().toISOString()})
        .eq('id', c.req.valid('param').id)
        .select('id')
        .returns<Array<{id: string}>>()
        .maybeSingle();
      if (error) {
        return c.json(
          internalError('failed to revoke the staff sessions', error),
          500,
        );
      }
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
    zValidator('param', StaffAccountIdParamSchema),
    async c => {
      // Lowercased before comparing: the param schema and Postgres both
      // accept a UUID in either case, while the claim is always lowercase,
      // so `/ABC.../disable` would otherwise slip past this check.
      const id = c.req.valid('param').id.toLowerCase();
      if (id === c.get('staff').sub.toLowerCase()) {
        return c.json({error: 'cannot disable your own account'}, 409);
      }
      const {error} = await createDbClient(c.env).rpc('disable_staff_account', {
        p_staff_account_id: id,
      });
      if (error) {
        if (error.code === ACCOUNT_NOT_FOUND_SQLSTATE) {
          return c.json({error: 'staff account not found'}, 404);
        }
        if (error.code === LAST_GENERAL_STAFF_SQLSTATE) {
          return c.json(
            {error: 'cannot disable the last general staff account'},
            409,
          );
        }
        return c.json(
          internalError('failed to disable the staff account', error),
          500,
        );
      }
      return c.json({ok: true});
    },
  )
  // Lets a disabled account log in again with the password it already had.
  // Its sessions stay ended: disabling moved `sessions_valid_from`, and
  // nothing here moves it back, so the owner logs in afresh.
  //
  // Any password link the account holds is dropped as well. Disabling
  // already deleted them, but a re-send that read the row just before the
  // disable committed can still have written one afterwards; that link is
  // refused while the account is disabled, and must not come back to life
  // now -- the account may have been disabled precisely because its
  // mailbox was compromised. A fresh link can be sent once it is enabled.
  .post(
    '/accounts/:id/enable',
    requireGeneralStaff(),
    zValidator('param', StaffAccountIdParamSchema),
    async c => {
      const {data: account, error} = await createDbClient(c.env)
        .from('staff_accounts')
        .update({disabled_at: null})
        .eq('id', c.req.valid('param').id)
        .select('id')
        .returns<Array<{id: string}>>()
        .maybeSingle();
      if (error) {
        return c.json(
          internalError('failed to enable the staff account', error),
          500,
        );
      }
      if (!account) {
        return c.json({error: 'staff account not found'}, 404);
      }
      const {error: deleteError} = await createDbClient(c.env)
        .from('staff_password_reset_tokens')
        .delete()
        .eq('staff_account_id', account.id);
      if (deleteError) {
        return c.json(
          internalError(
            'failed to clear the links of the enabled staff account',
            deleteError,
          ),
          500,
        );
      }
      return c.json({ok: true});
    },
  );
