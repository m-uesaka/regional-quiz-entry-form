import {Hono} from 'hono';
import {StaffPendingInvitesSchema} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireStaff} from '../middleware/staff-auth';
import {createDbClient} from '../lib/db';
import {internalError} from '../lib/errors';
import {findPendingInviteScopes} from '../lib/staff-account-lookup';

// Which of the logged-in address's other accounts still wait on their
// invite link. A login is let into the one account its 区分 names, so an
// address whose 最強位 account is set up and whose 新人王 one isn't logs in
// to the former without a word about the latter -- and its owner, looking
// at the wrong tournament's empty entry list, can't tell why. The staff
// screens ask this on every layout load, so the warning stays for as long
// as the invite is outstanding and goes once it is followed.
//
// Behind a live session only: the caller is told about their own address's
// accounts, so this is no oracle for which addresses hold which accounts.
export const staffPendingInvitesRoute = new Hono<StaffEnv>().get(
  '/pending-invites',
  requireStaff(),
  async c => {
    const db = createDbClient(c.env);
    const staff = c.get('staff');
    const {data: account, error} = await db
      .from('staff_accounts')
      .select('email')
      .eq('id', staff.sub)
      .maybeSingle();
    if (error) {
      return c.json(
        internalError('failed to read the staff account', error),
        500,
      );
    }
    // The session check has just found the row, so it is only missing if
    // the account was deleted in between: there is nothing to warn about.
    if (!account) {
      return c.json(StaffPendingInvitesSchema.parse({scopes: []}));
    }
    const {scopes, error: lookupError} = await findPendingInviteScopes(
      db,
      account.email,
      staff.sub,
    );
    if (lookupError) {
      return c.json(
        internalError('failed to read the pending staff invites', lookupError),
        500,
      );
    }
    return c.json(StaffPendingInvitesSchema.parse({scopes}));
  },
);
