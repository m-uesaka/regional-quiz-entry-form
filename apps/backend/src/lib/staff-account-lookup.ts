import {
  StaffLoginScopeSchema,
  type StaffLoginScope,
} from '@regional-quiz/shared';
import type {DbClient} from './db';
import {isPasswordHashUsable} from './password';

/**
 * Looks up the enabled staff account an address and a scope name, the way
 * both the login and the reset request (#175) name one, so the two can't
 * come to resolve the same pair to different accounts.
 *
 * The address alone may name two accounts -- a region's 最強位 and 新人王
 * run from one mailbox (#166) -- so `scope` picks the one: a tournament type
 * for regional staff, or `general` for general staff, whose rows carry a
 * null type. The unique constraint on (email, tournament_type) leaves at
 * most one row either way.
 *
 * A disabled account (#156) is simply not looked for, so it is answered
 * exactly like an address that was never registered.
 * @param db The Supabase client to read with.
 * @param email The address, already lowercased by the request schema.
 * @param scope Which of the address's accounts.
 * @param columns The `select` to read the account with. A string literal,
 *     so the row it reads is inferred from it.
 */
export async function findStaffAccountByScope<Columns extends string>(
  db: DbClient,
  email: string,
  scope: StaffLoginScope,
  columns: Columns,
) {
  const query = db
    .from('staff_accounts')
    .select(columns)
    .eq('email', email)
    .is('disabled_at', null);
  return (
    scope === 'general'
      ? query.is('tournament_type', null)
      : query.eq('tournament_type', scope)
  ).maybeSingle();
}

/**
 * The scopes of the address's other enabled accounts whose owner hasn't
 * followed their invite link yet, i.e. whose `password_hash` is still
 * `UNUSABLE_PASSWORD_HASH`.
 *
 * A login is let into the one account its `scope` names, so an address with
 * a 最強位 account set up and a 新人王 one still waiting on its invite logs in
 * to the former without a word about the latter -- and its owner, looking at
 * the wrong tournament's empty entry list, has no way to tell why. The login
 * hands these back so the staff screens can say so.
 *
 * Asked only after the password has been proven: the mailbox's owner is the
 * one being told about their own accounts, so this is no oracle for which
 * addresses hold which accounts.
 * @param db The Supabase client to read with.
 * @param email The address, already lowercased by the request schema.
 * @param loggedInId The account just logged in to, which is left out.
 * @return The scopes in the order `StaffLoginScopeSchema` lists them, or
 *     `null` if the accounts couldn't be read.
 */
export async function findPendingInviteScopes(
  db: DbClient,
  email: string,
  loggedInId: string,
): Promise<StaffLoginScope[] | null> {
  const {data, error} = await db
    .from('staff_accounts')
    .select('tournament_type, password_hash')
    .eq('email', email)
    .is('disabled_at', null)
    .neq('id', loggedInId);
  if (error) return null;
  const pending = new Set<StaffLoginScope>(
    data
      .filter(account => !isPasswordHashUsable(account.password_hash))
      .map(account => account.tournament_type ?? 'general'),
  );
  return StaffLoginScopeSchema.options.filter(scope => pending.has(scope));
}
