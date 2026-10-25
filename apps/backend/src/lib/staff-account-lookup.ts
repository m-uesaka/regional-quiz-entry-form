import type {StaffLoginScope} from '@regional-quiz/shared';
import type {createDbClient} from './db';

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
 * @param columns The `select` to read the account with.
 */
export async function findStaffAccountByScope<Row>(
  db: ReturnType<typeof createDbClient>,
  email: string,
  scope: StaffLoginScope,
  columns: string,
): Promise<{data: Row | null; error: {message: string} | null}> {
  const query = db
    .from('staff_accounts')
    .select(columns)
    .eq('email', email)
    .is('disabled_at', null);
  return (
    scope === 'general'
      ? query.is('tournament_type', null)
      : query.eq('tournament_type', scope)
  )
    .returns<Row[]>()
    .maybeSingle();
}
