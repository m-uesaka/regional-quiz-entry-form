import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {hashToken} from './token';

type ConfirmResult =
  {ok: true; status: 'confirmed' | 'waitlisted'} | {ok: false; error: string};

interface TokenRow {
  id: string;
  entry_id: string;
  expires_at: string;
  used_at: string | null;
  entries: {
    tournament_id: string;
    tournaments: {capacity: number | null};
  };
}

/**
 * Confirms the `entries` row a verification token was issued for.
 *
 * The entry is set to `confirmed` if the tournament still has capacity, or
 * `waitlisted` (with the next `waitlist_position`) otherwise. The token is
 * marked used so it can't be replayed.
 * @param env The Worker bindings.
 * @param token The raw token from the verification link.
 */
export async function confirmEntryByToken(
  env: Bindings,
  token: string,
): Promise<ConfirmResult> {
  const db = createDbClient(env);

  const {data: tokenRow} = await db
    .from('email_verification_tokens')
    .select(
      'id, entry_id, expires_at, used_at, ' +
        'entries(tournament_id, tournaments(capacity))',
    )
    .eq('token_hash', await hashToken(token))
    .returns<TokenRow[]>()
    .maybeSingle();
  if (
    !tokenRow ||
    tokenRow.used_at !== null ||
    new Date(tokenRow.expires_at) < new Date()
  ) {
    return {ok: false, error: 'invalid or expired token'};
  }

  const {tournament_id: tournamentId} = tokenRow.entries;
  const capacity = tokenRow.entries.tournaments.capacity;
  const {count: confirmedCount} = await db
    .from('entries')
    .select('id', {count: 'exact', head: true})
    .eq('tournament_id', tournamentId)
    .eq('status', 'confirmed');

  const status =
    capacity !== null && (confirmedCount ?? 0) >= capacity
      ? 'waitlisted'
      : 'confirmed';

  let waitlistPosition: number | null = null;
  if (status === 'waitlisted') {
    const {count: waitlistedCount} = await db
      .from('entries')
      .select('id', {count: 'exact', head: true})
      .eq('tournament_id', tournamentId)
      .eq('status', 'waitlisted');
    waitlistPosition = (waitlistedCount ?? 0) + 1;
  }

  const {error: updateError} = await db
    .from('entries')
    .update({
      status,
      email_verified_at: new Date().toISOString(),
      waitlist_position: waitlistPosition,
    })
    .eq('id', tokenRow.entry_id);
  if (updateError) {
    return {ok: false, error: updateError.message};
  }

  await db
    .from('email_verification_tokens')
    .update({used_at: new Date().toISOString()})
    .eq('id', tokenRow.id);

  return {ok: true, status};
}
