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
  'regions(slug, name)';

/** Shape of a `staff_accounts` row as selected above. */
interface StaffAccountRow {
  id: string;
  email: string;
  password_hash: string;
  role: StaffRole;
  region_id: string | null;
  tournament_type: TournamentType | null;
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
        // 23505 is the unique violation on `email`, and 23503 the foreign key
        // on `region_id`. Both are input mistakes the staff member can fix
        // from the form they just submitted, so they get an answer they can
        // act on rather than a 500.
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
        .select('id, email')
        .eq('id', c.req.valid('param').id)
        .returns<Array<{id: string; email: string}>>()
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
  );
