// The few reads and writes a spec makes straight against Postgres, for
// what no API exposes: how many entrants a bulk send ought to reach, and a
// confirmation link that has run out without waiting 24 hours for it.
//
// Same local-only guard as `./seed.ts`, since these write too.

import {assertLocalSupabase, createServiceRoleClient} from './seed';

/**
 * How many distinct addresses a bulk send with no `statusFilter` should
 * reach in `tournamentId`: confirmed or waitlisted entries whose owner has
 * confirmed their address (#192).
 *
 * Written from the rule rather than from the backend's query, so a spec
 * comparing the two catches the backend drifting from it. Only exact while
 * nothing else is entering the tournament, which `workers: 1` ensures.
 * @param tournamentId The tournament to count.
 */
export async function countDefaultMailRecipients(
  tournamentId: string,
): Promise<number> {
  assertLocalSupabase();
  const {data, error} = await createServiceRoleClient()
    .from('entries')
    .select('status, participants(email, email_verified_at)')
    .eq('tournament_id', tournamentId)
    .returns<
      Array<{
        status: string;
        participants: {email: string; email_verified_at: string | null};
      }>
    >();
  if (error) {
    throw new Error(`counting the mail recipients failed: ${error.message}`);
  }
  const addresses = new Set(
    data
      .filter(
        row =>
          (row.status === 'confirmed' || row.status === 'waitlisted') &&
          row.participants.email_verified_at !== null,
      )
      .map(row => row.participants.email),
  );
  return addresses.size;
}

/**
 * Lets every confirmation link of `email`'s entries run out, as 24 hours
 * would.
 * @param email The participant whose links to expire.
 */
export async function expireVerificationLinks(email: string): Promise<void> {
  assertLocalSupabase();
  const db = createServiceRoleClient();
  const {data: entries, error: entriesError} = await db
    .from('entries')
    .select('id, participants!inner(email)')
    .eq('participants.email', email);
  if (entriesError) {
    throw new Error(`reading the entries failed: ${entriesError.message}`);
  }
  const {error} = await db
    .from('email_verification_tokens')
    .update({expires_at: new Date(Date.now() - 60_000).toISOString()})
    .in(
      'entry_id',
      entries.map(entry => entry.id),
    )
    .is('used_at', null);
  if (error) {
    throw new Error(`expiring the links failed: ${error.message}`);
  }
}
