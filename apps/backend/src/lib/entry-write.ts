/**
 * @fileoverview The write stage of an entry submission and its undoing: the
 * lookup of the participant's cancelled entry to reuse, the `entries` row
 * (`writeEntry()`), the regulation selection (`storeEntryRegulations()`), and
 * `rollbackEntry()`, which puts the row back from the snapshot taken before.
 * The snapshot's type, its select and the restore live together here, so a
 * column added to one is added to the others.
 */

import {ENTRY_ERROR_CODES, type EntrySessionInput} from '@regional-quiz/shared';
import {type DbClient, type Tables, type TablesInsert} from './db';
import {UnexpectedFailure, unwrap, type ClientFailure} from './errors';
import {
  FOREIGN_KEY_VIOLATION_SQLSTATE,
  NO_ROW_PGRST_CODE,
  PARTICIPANT_REGION_SQLSTATE,
  REGION_DUAL_ENTRY_SQLSTATE,
  UNIQUE_VIOLATION_SQLSTATE,
} from './pg-errors';

/**
 * The participant's existing entry for the tournament, if there is one.
 *
 * Every column `reenter_cancelled_entry()` (migrations 0041, 0052, 0057)
 * overwrites is selected, not just the ones the reuse decision is made on, so
 * a re-entry that fails afterwards can put the row back exactly as it was. A
 * column added to that function's `set` list has to be added here and to
 * `rollbackEntry()`; the test of a re-entry whose mail fails compares the
 * whole row, so one that was missed fails there.
 */
export interface ExistingEntryRow extends Pick<
  Tables<'entries'>,
  | 'id'
  | 'name'
  | 'furigana'
  | 'display_name'
  | 'free_text'
  | 'status'
  | 'waitlist_position'
  | 'email_verified_at'
  | 'confirmed_at'
  | 'cancelled_at'
  | 'custom_field_values'
> {
  // The row's own regulation selection, as a to-many embed. Restored as a
  // whole on rollback, because the reuse path replaces the set rather than
  // editing it in place.
  entry_regulations: Array<Pick<Tables<'entry_regulations'>, 'regulation_id'>>;
}

/** The columns of `ExistingEntryRow`, for the snapshot select. */
const EXISTING_ENTRY_COLUMNS = `
  id, name, furigana, display_name, entry_regulations(regulation_id),
  free_text, custom_field_values, status, waitlist_position,
  email_verified_at, confirmed_at, cancelled_at
`;

/**
 * Replaces an entry's regulation selection with `regulationIds`.
 *
 * Written as its own statement rather than alongside the entry: the
 * Supabase client speaks REST, so there is no transaction to put both in.
 * The delete comes first because the reuse path starts from a row that
 * still carries the selection of the entry it was cancelled from — a
 * re-entry's own choice replaces that set wholesale rather than merging
 * into it.
 *
 * Duplicate ids are collapsed. A hand-made request could repeat one, and
 * the `(entry_id, regulation_id)` primary key would answer that with a
 * constraint violation rather than with the selection the participant
 * plainly meant.
 * @param db The Supabase client to write with.
 * @param entryId The entry whose selection is being written.
 * @param tournamentId The entry's tournament, carried on every row so the
 *     composite foreign keys can tie entry and regulation to one tournament.
 * @param regulationIds The regulations the entry claims.
 */
async function replaceEntryRegulations(
  db: DbClient,
  entryId: string,
  tournamentId: string,
  regulationIds: readonly string[],
): Promise<{error: {message: string; code: string} | null}> {
  const {error: deleteError} = await db
    .from('entry_regulations')
    .delete()
    .eq('entry_id', entryId);
  if (deleteError) {
    return {error: deleteError};
  }
  const {error} = await db.from('entry_regulations').insert(
    [...new Set(regulationIds)].map(regulationId => ({
      entry_id: entryId,
      regulation_id: regulationId,
      tournament_id: tournamentId,
    })),
  );
  return {error};
}

/**
 * Undoes a half-finished `createEntry()`, so a submission that failed after
 * the `entries` row was written doesn't leave one behind. Leaving it in
 * place would permanently block a retry — on the unique
 * (participant_id, tournament_id) constraint for a new row, or on the
 * 'already entered' check for a reused one — even though the participant
 * never got an entry out of it.
 * @param db The Supabase client to write with.
 * @param entryId The entry written by the attempt being rolled back.
 * @param tournamentId The entry's tournament.
 * @param existingEntry The snapshot of the cancelled row the attempt reused,
 *     or `null` when it inserted a fresh entry.
 */
export async function rollbackEntry(
  db: DbClient,
  entryId: string,
  tournamentId: string,
  existingEntry: ExistingEntryRow | null,
): Promise<void> {
  // The verification tokens go first. Deleting the entry would take them
  // with it (`on delete cascade`, 0058), but the reuse path keeps the row,
  // and dropping them there is what stops a link that did go out from
  // confirming an entry that has been put back into its cancellation.
  const {error: tokensError} = await db
    .from('email_verification_tokens')
    .delete()
    .eq('entry_id', entryId);
  if (tokensError) {
    console.error('failed to delete the verification tokens', {
      entryId,
      code: tokensError.code,
      error: tokensError.message,
    });
  }

  if (!existingEntry) {
    // `entry_regulations` references the entry `on delete cascade`, so the
    // selection written for it goes with the row.
    //
    // Logged rather than reported, as on the reuse path below. A row left
    // behind here is a `pending_verification` entry whose link never
    // arrived: a retry is refused as waiting for that link until the row
    // lapses (`lapse_expired_pending_entries()`, 0054), so it must not pass
    // silently either.
    const {error: entryError} = await db
      .from('entries')
      .delete()
      .eq('id', entryId);
    if (entryError) {
      console.error('failed to delete the entry', {
        entryId,
        code: entryError.code,
        error: entryError.message,
      });
    }
    return;
  }

  // A reused row is put back into the cancellation it came from rather than
  // deleted, so a failed re-entry doesn't erase the record of the original
  // entry. Every column `reenter_cancelled_entry()` overwrote is restored from
  // the snapshot taken before it: restoring only the status would still leave
  // the cancelled entry permanently carrying the failed re-entry's answers
  // and its cleared verification timestamp.
  const {error: restoreError} = await db
    .from('entries')
    .update({
      name: existingEntry.name,
      furigana: existingEntry.furigana,
      display_name: existingEntry.display_name,
      free_text: existingEntry.free_text,
      custom_field_values: existingEntry.custom_field_values,
      status: existingEntry.status,
      waitlist_position: existingEntry.waitlist_position,
      email_verified_at: existingEntry.email_verified_at,
      // Whether the cancelled entry still holds its region after the entry
      // period (0052): losing it would let the participant into another
      // region's tournament on the same question set.
      confirmed_at: existingEntry.confirmed_at,
      cancelled_at: existingEntry.cancelled_at,
    })
    .eq('id', entryId);
  if (restoreError) {
    console.error('failed to restore the cancelled entry', {
      entryId,
      error: restoreError.message,
    });
  }

  // The regulation selection lives in its own table, so it is rewritten
  // rather than restored by the update above.
  //
  // Both writes are logged rather than reported: the caller is already on a
  // failure path and has an error of its own to answer with, and there is
  // nothing further it could do about a rollback that didn't take. But a
  // failure here is the one that leaves no trace anywhere else — the
  // cancelled entry stays in the participant's history carrying none of the
  // regulations it was entered under — so it must not pass silently.
  const {error: regulationsError} = await replaceEntryRegulations(
    db,
    entryId,
    tournamentId,
    existingEntry.entry_regulations.map(row => row.regulation_id),
  );
  if (regulationsError) {
    console.error('failed to restore the cancelled entry regulations', {
      entryId,
      regulationIds: existingEntry.entry_regulations.map(
        row => row.regulation_id,
      ),
      code: regulationsError.code,
      error: regulationsError.message,
    });
  }
}

/**
 * The stage of `enterTournament()` that looks up the participant's existing
 * entry for the tournament, refusing the submission unless there is none or
 * it is cancelled.
 * @param db The Supabase client to read with.
 * @param participantId The participant being entered.
 * @param tournamentId The tournament being entered.
 * @return The cancelled entry to reuse, as a snapshot `rollbackEntry()` can
 *     restore, or `null` when a fresh entry is to be inserted.
 */
export async function findReusableEntry(
  db: DbClient,
  participantId: string,
  tournamentId: string,
): Promise<
  {ok: true; existingEntry: ExistingEntryRow | null} | ClientFailure<409>
> {
  // A participant who cancelled may enter the same tournament again with the
  // same credentials. The unique (participant_id, tournament_id) constraint
  // means that has to reuse the cancelled row instead of inserting a second
  // one.
  const existingEntry = unwrap(
    await db
      .from('entries')
      .select(EXISTING_ENTRY_COLUMNS)
      .eq('participant_id', participantId)
      .eq('tournament_id', tournamentId)
      .maybeSingle(),
    'failed to read the existing entry',
  );
  if (existingEntry && existingEntry.status !== 'cancelled') {
    return {
      ok: false,
      status: 409,
      // Still pending after `lapseExpiredPendingEntries()` means its link is
      // still valid.
      error:
        existingEntry.status === 'pending_verification'
          ? ENTRY_ERROR_CODES.ENTRY_PENDING_VERIFICATION
          : ENTRY_ERROR_CODES.ALREADY_ENTERED,
    };
  }
  return {ok: true, existingEntry};
}

/**
 * The stage of `enterTournament()` that writes the `entries` row: a fresh
 * insert, or `reenter_cancelled_entry()` over the participant's own
 * cancelled row. This is the write `check_entry_seat()` refuses, for the
 * region's dual-entry rule and for a seat held in another region on the same
 * question set alike. Nothing is left behind when it fails, so there is
 * nothing to roll back.
 * @param db The Supabase client to write with.
 * @param participantId The participant being entered.
 * @param tournamentId The tournament being entered.
 * @param input The entry itself.
 * @param existingEntry The cancelled entry to reuse, from
 *     `findReusableEntry()`, or `null` to insert a fresh one.
 */
export async function writeEntry(
  db: DbClient,
  participantId: string,
  tournamentId: string,
  input: EntrySessionInput,
  existingEntry: ExistingEntryRow | null,
): Promise<{ok: true; entryId: string} | ClientFailure<409>> {
  const entryValues = {
    participant_id: participantId,
    tournament_id: tournamentId,
    name: input.name,
    furigana: input.furigana,
    display_name: input.displayName,
    free_text: input.freeText ?? null,
    custom_field_values: input.customFieldValues,
    status: 'pending_verification',
  } satisfies TablesInsert<'entries'>;

  const {data: entry, error} = existingEntry
    ? await db
        // Takes the participant row before the entry's, the order a takeover
        // takes them in, which an update here would reverse. It also resets
        // the row to what a fresh insert would be and drops the dead tokens
        // of the entry it was cancelled from, with the status flip, so a
        // refused re-entry changes nothing. It matches no row once the row
        // stopped being `cancelled`, so two concurrent re-entries behave like
        // two concurrent first entries: the second one is refused instead of
        // mailing a second verification link for the same entry.
        .rpc('reenter_cancelled_entry', {
          p_entry_id: existingEntry.id,
          p_participant_id: participantId,
          p_name: entryValues.name,
          p_furigana: entryValues.furigana,
          p_display_name: entryValues.display_name,
          p_free_text: entryValues.free_text,
          p_custom_field_values: entryValues.custom_field_values,
        })
        .select('id')
        .single()
    : await db.from('entries').insert(entryValues).select('id').single();
  // `check_entry_seat()` is the only place the rule of
  // `regions.allows_dual_entry` and the rule against two regions on one
  // question set are decided: it decides under the participant's row lock,
  // so nothing checked ahead of the write could add to it, and a copy here
  // could only drift from it.
  if (error?.code === REGION_DUAL_ENTRY_SQLSTATE) {
    // The statement or function was rolled back, so nothing was written: the
    // row stays the cancellation it was, with its tokens, and there is
    // nothing to roll back here.
    return {
      ok: false,
      status: 409,
      error: ENTRY_ERROR_CODES.ALREADY_ENTERED_ANOTHER_TOURNAMENT,
    };
  }
  // The participant holds a seat in another region on the same question set
  // (0043). Taking part there is what stops an entry here, not having
  // registered there: a participant who cancelled there in time can enter
  // here (#236). Retrying won't change a seat that is really there, so even
  // one a concurrent submission just took is answered as taking part there
  // rather than as a concurrent submission.
  if (error?.code === PARTICIPANT_REGION_SQLSTATE) {
    return {
      ok: false,
      status: 409,
      error: ENTRY_ERROR_CODES.ALREADY_REGISTERED_IN_ANOTHER_REGION,
    };
  }
  // A concurrent submission got there first: it inserted the same entry, or
  // -- on a re-entry -- took or deleted the cancelled row `.single()` was
  // looking for.
  if (
    error?.code === UNIQUE_VIOLATION_SQLSTATE ||
    (existingEntry && error?.code === NO_ROW_PGRST_CODE)
  ) {
    return {
      ok: false,
      status: 409,
      error: ENTRY_ERROR_CODES.CONCURRENT_SUBMISSION,
    };
  }
  if (error || !entry) {
    // Anything else -- a check constraint (0021's length limits), Supabase
    // being down -- is ours to fix, and its message names the table and
    // the constraint, so it goes to the log behind a 500 (#191).
    throw new UnexpectedFailure(
      'failed to create the entry',
      error ?? {message: 'the write returned no row'},
    );
  }
  return {ok: true, entryId: entry.id};
}

/**
 * The stage of `enterTournament()` that writes the regulations the new entry
 * claims.
 * @param db The Supabase client to write with.
 * @param entryId The entry `writeEntry()` wrote.
 * @param tournamentId The entry's tournament.
 * @param regulationIds The regulations the entry claims.
 */
export async function storeEntryRegulations(
  db: DbClient,
  entryId: string,
  tournamentId: string,
  regulationIds: readonly string[],
): Promise<{ok: true} | ClientFailure<409>> {
  // The selection is written after the entry because it references it. The
  // composite foreign keys behind `entry_regulations` are what refuse a
  // regulation belonging to another tournament, so a submission that got
  // past `regulationSelectionRefusal()` on a regulation list
  // `sync_regulations()` deleted from under it is stopped here rather than
  // stored — which is why a failure rolls the entry back instead of leaving
  // one claiming nothing.
  const {error: regulationsError} = await replaceEntryRegulations(
    db,
    entryId,
    tournamentId,
    regulationIds,
  );
  if (regulationsError) {
    console.error('failed to store the entry regulations', {
      entryId,
      code: regulationsError.code,
      error: regulationsError.message,
    });
    // A regulation dropped by a concurrent `sync_regulations()` is the only
    // failure of that write the participant can act on, so it alone earns
    // `REGULATION_NO_LONGER_AVAILABLE`. Anything else is a server fault, and
    // telling the participant their regulations changed would send them to
    // reload a page that will fail again in exactly the same way.
    if (regulationsError.code !== FOREIGN_KEY_VIOLATION_SQLSTATE) {
      throw new UnexpectedFailure(
        'failed to store the entry regulations',
        regulationsError,
      );
    }
    return {
      ok: false,
      status: 409,
      error: ENTRY_ERROR_CODES.REGULATION_NO_LONGER_AVAILABLE,
    };
  }
  return {ok: true};
}
