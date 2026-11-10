/**
 * @fileoverview What an entry submission checks about an unverified account
 * (#189) that another submission may have taken over: the tournaments a
 * takeover withdrew entries from, for the mails that tell their owner, and
 * whether the account still has the password this submission gave it.
 */

import {ENTRY_ERROR_CODES} from '@regional-quiz/shared';
import type {DbClient} from './db';
import type {EntryTournamentRow} from './entry-submission-types';
import type {ClientFailure} from './errors';
import {tournamentDisplayName} from './tournaments';

/**
 * The display names of the tournaments whose pending entries a takeover
 * withdrew, for the verification mail of the entry that took over.
 *
 * Those entries may well have been the address owner's own -- a mistyped
 * password, or a tournament in another region, is enough for a takeover --
 * and the verification mail is the one message that reaches only the owner,
 * so it is where they learn which entries to make again.
 * @param db The Supabase client to read with.
 * @param tournamentIds The tournaments `take_over_unverified_participant()`
 *     reported, less the one being entered now.
 * @return `undefined` when nothing was withdrawn. A failed read still
 *     reports the withdrawal, without the names (an empty list).
 */
export async function withdrawnTournamentNames(
  db: DbClient,
  tournamentIds: string[],
): Promise<string[] | undefined> {
  if (tournamentIds.length === 0) {
    return undefined;
  }
  const {data, error} = await db
    .from('tournaments')
    .select('name, type, regions(name)')
    .in('id', tournamentIds);
  if (error || !data) {
    console.error('failed to look up the withdrawn tournaments', {
      tournamentIds,
      error: error?.message,
    });
    return [];
  }
  return data.map(row =>
    tournamentDisplayName(row.name, row.regions.name, row.type),
  );
}

/**
 * The tournaments a takeover withdrew pending entries from, for the notice
 * of a submission that then failed: the ones the verification mail would
 * have named, and this tournament too if it had one, since that entry is
 * gone with nothing to replace it.
 * @param tournament The tournament the submission tried to enter.
 * @param withdrawnIds Every tournament `take_over_unverified_participant()`
 *     reported.
 * @param otherNames What `withdrawnTournamentNames()` read for the rest.
 * @return `undefined` when nothing was withdrawn, and an empty list when
 *     the names of the rest couldn't be read: naming only this tournament
 *     would read as if it were the only one.
 */
export function withdrawnWithoutReplacement(
  tournament: EntryTournamentRow,
  withdrawnIds: readonly string[],
  otherNames: string[] | undefined,
): string[] | undefined {
  if (!withdrawnIds.includes(tournament.id)) {
    return otherNames;
  }
  // `withdrawnTournamentNames()` answers empty only for a failed read.
  if (otherNames?.length === 0) {
    return [];
  }
  return [
    tournamentDisplayName(
      tournament.name,
      tournament.regions.name,
      tournament.type,
    ),
    ...(otherNames ?? []),
  ];
}

/**
 * The stage of `enterTournament()` that refuses the submission when a later
 * one has taken the unverified account over since (see
 * `isStillUnverifiedAccountOf()`).
 * @param db The Supabase client to read with.
 * @param participantId The account the entry was written for.
 * @param passwordHash The hash this submission set on it.
 */
export async function ensureStillUnverifiedAccountOf(
  db: DbClient,
  participantId: string,
  passwordHash: string,
): Promise<{ok: true} | ClientFailure<409>> {
  if (!(await isStillUnverifiedAccountOf(db, participantId, passwordHash))) {
    return {
      ok: false,
      status: 409,
      error: ENTRY_ERROR_CODES.SUPERSEDED_BY_LATER_SUBMISSION,
    };
  }
  return {ok: true};
}

/**
 * Whether the unverified account an entry was just written for still has
 * the password this submission gave it.
 *
 * Every link mailed for an unverified account has to belong to a
 * submission made with the account's current password, because
 * following it is what verifies the account with them (migration 0034).
 * `take_over_unverified_participant()` keeps that by deleting the earlier
 * submissions' entries, but it can only delete entries that exist: one
 * written after a later submission took the account over would carry a link
 * that verifies the account with that later submission's password -- and
 * the later submitter is not necessarily the owner of the address.
 *
 * Read after the entry is written, which leaves no gap: a takeover that
 * commits before this read is seen here, and one that commits after it
 * deletes the entry (and with it the link) itself.
 *
 * A takeover is the only thing that changes an unverified account's hash:
 * a password reset is refused for one (`reset_participant_password()`,
 * migration 0034), so a reset made while this entry was being written can't
 * be mistaken for a later submission and withdraw it.
 * @param db The Supabase client to read with.
 * @param participantId The account the entry was written for.
 * @param passwordHash The hash this submission set on it.
 */
async function isStillUnverifiedAccountOf(
  db: DbClient,
  participantId: string,
  passwordHash: string,
): Promise<boolean> {
  const {data} = await db
    .from('participants')
    .select('password_hash')
    .eq('id', participantId)
    .maybeSingle();
  // A failed read counts as taken over: mailing a link that might verify
  // someone else's password is worse than asking the owner to try again.
  return data?.password_hash === passwordHash;
}
