/**
 * @fileoverview A participant's own edits to, and cancellations of, entries
 * they already made (`/mypage/entries/:entryId`). Making an entry in the
 * first place is `entry-submission.ts`.
 */

import {
  COMMON_ERROR_CODES,
  ENTRY_ERROR_CODES,
  isEditableEntryStatus,
  NOT_EDITABLE_ENTRY_CODES,
  isWithinEntryPeriod,
  type EntryEditInput,
} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import type {LibFailure} from './errors';
import {validateCustomFieldValues} from './form-field-defs';
import {promoteWaitlistedEntries} from './waitlist';

type UpdateOwnEntryResult = {ok: true} | LibFailure<400 | 403 | 404>;

type CancelOwnEntryResult = {ok: true} | LibFailure<404>;

/**
 * Applies a participant's own edits to one of their entries
 * (`PATCH /mypage/entries/:entryId`).
 *
 * The entry is looked up by `(id, participant_id)` so another participant's
 * entry is indistinguishable from a nonexistent one; edits are refused once
 * the tournament's entry period has closed or the entry was cancelled, and
 * the custom field answers are checked against the tournament's own form
 * definition rather than trusted from the client.
 * @param env The Worker bindings.
 * @param participantId The logged-in participant, from the session cookie.
 * @param entryId The entry to update.
 * @param patch The validated editable fields.
 */
export async function updateOwnEntry(
  env: Bindings,
  participantId: string,
  entryId: string,
  patch: EntryEditInput,
): Promise<UpdateOwnEntryResult> {
  const db = createDbClient(env);

  const {data: entry, error: lookupError} = await db
    .from('entries')
    .select(
      'id, tournament_id, status, tournaments(entry_opens_at, entry_closes_at)',
    )
    .eq('id', entryId)
    .eq('participant_id', participantId)
    .maybeSingle();
  // A failed lookup must not be reported as a missing entry: that would hide
  // a database/network outage behind a 404.
  if (lookupError) {
    return {ok: false, status: 500, error: lookupError.message};
  }
  if (!entry) {
    return {ok: false, status: 404, error: COMMON_ERROR_CODES.ENTRY_NOT_FOUND};
  }

  if (
    !isWithinEntryPeriod(
      entry.tournaments.entry_opens_at,
      entry.tournaments.entry_closes_at,
    )
  ) {
    return {
      ok: false,
      status: 403,
      error: ENTRY_ERROR_CODES.ENTRY_PERIOD_CLOSED,
    };
  }
  if (!isEditableEntryStatus(entry.status)) {
    return {
      ok: false,
      status: 403,
      error: NOT_EDITABLE_ENTRY_CODES[entry.status],
    };
  }

  const customFieldValuesCheck = await validateCustomFieldValues(
    db,
    entry.tournament_id,
    patch.customFieldValues,
  );
  if (!customFieldValuesCheck.ok) {
    return customFieldValuesCheck;
  }

  const {error} = await db
    .from('entries')
    .update({
      name: patch.name,
      furigana: patch.furigana,
      display_name: patch.displayName,
      free_text: patch.freeText ?? null,
      custom_field_values: patch.customFieldValues,
    })
    .eq('id', entryId);
  if (error) {
    return {ok: false, status: 500, error: error.message};
  }
  return {ok: true};
}

/**
 * Cancels one of the participant's own entries
 * (`DELETE /mypage/entries/:entryId`).
 *
 * The entry is looked up by `(id, participant_id)` so another participant's
 * entry is indistinguishable from a nonexistent one. Freeing a `confirmed`
 * seat promotes the head of the tournament's waitlist; cancelling from the
 * waitlist itself only closes the gap in the queue, and cancelling before
 * the entry was ever verified burns its outstanding verification token (see
 * the migration).
 * Cancelling an already-cancelled entry succeeds without promoting anyone.
 * @param env The Worker bindings.
 * @param participantId The logged-in participant, from the session cookie.
 * @param entryId The entry to cancel.
 */
export async function cancelOwnEntry(
  env: Bindings,
  participantId: string,
  entryId: string,
): Promise<CancelOwnEntryResult> {
  const db = createDbClient(env);

  // The status change, the waitlist renumbering, and the read of the status
  // the entry had beforehand all happen inside one locked transaction, so
  // two concurrent cancellations of the same seat can't both trigger a
  // promotion (see `supabase/migrations/0006_cancel_own_entry_fn.sql`).
  const {data, error} = await db.rpc('cancel_own_entry', {
    p_entry_id: entryId,
    p_participant_id: participantId,
  });
  if (error) {
    return {ok: false, status: 500, error: error.message};
  }

  const cancelled = data?.[0];
  if (!cancelled) {
    return {ok: false, status: 404, error: COMMON_ERROR_CODES.ENTRY_NOT_FOUND};
  }

  if (cancelled.previous_status === 'confirmed') {
    try {
      // The cancellation above is already committed, so a
      // `pending_verification` entry can be confirmed before this runs. With
      // anyone waiting, `confirm_entry_by_token` queues it behind them
      // rather than into the freed seat (0047, #283); with nobody waiting
      // it may take the seat, and `promote_waitlisted_entries` -- counting
      // the free seats under its own tournament lock -- then promotes
      // nobody instead of pushing the tournament over capacity. A mail it
      // couldn't send is logged there.
      await promoteWaitlistedEntries(env, cancelled.entry_tournament_id);
    } catch (promotionError) {
      // The cancellation itself is already committed, so failing the request
      // would tell the participant their cancellation didn't go through when
      // it did. Log instead: what's lost is the promotion of the next
      // waitlisted entry (or only its notification mail), which staff can
      // re-run, not the participant's own action.
      console.error('failed to promote the next waitlisted entry', {
        tournamentId: cancelled.entry_tournament_id,
        error: promotionError,
      });
    }
  }
  return {ok: true};
}
