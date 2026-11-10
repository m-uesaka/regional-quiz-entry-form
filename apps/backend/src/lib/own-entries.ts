/**
 * @fileoverview A participant's own edits to, and cancellations of, entries
 * they already made (`/mypage/entries/:entryId`). Making an entry in the
 * first place is `entry-submission.ts`.
 */

import {
  COMMON_ERROR_CODES,
  EDITABLE_ENTRY_STATUSES,
  ENTRY_EDIT_ERROR_CODES,
  ENTRY_ERROR_CODES,
  isEditableEntryStatus,
  NOT_EDITABLE_ENTRY_CODES,
  isWithinEntryPeriod,
  type EntryEditInput,
} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {type DbClient} from './db';
import {unwrap, type ClientFailure} from './errors';
import {validateCustomFieldValues} from './form-field-defs';
import {promoteWaitlistedEntries} from './waitlist';

type UpdateOwnEntryResult = {ok: true} | ClientFailure<400 | 403 | 404>;

type CancelOwnEntryResult = {ok: true} | ClientFailure<404>;

/**
 * Applies a participant's own edits to one of their entries
 * (`PATCH /mypage/entries/:entryId`).
 *
 * The entry is looked up by `(id, participant_id)` so another participant's
 * entry is indistinguishable from a nonexistent one; edits are refused once
 * the tournament's entry period has closed or the entry was cancelled, and
 * the custom field answers are checked against the tournament's own form
 * definition rather than trusted from the client.
 * @param db The database client.
 * @param participantId The logged-in participant, from the session cookie.
 * @param entryId The entry to update.
 * @param patch The validated editable fields.
 */
export async function updateOwnEntry(
  db: DbClient,
  participantId: string,
  entryId: string,
  patch: EntryEditInput,
): Promise<UpdateOwnEntryResult> {
  // A failed lookup must not be reported as a missing entry: that would hide
  // a database/network outage behind a 404, so `unwrap()` throws it.
  const entry = unwrap(
    await db
      .from('entries')
      .select(
        'id, tournament_id, status, tournaments(entry_opens_at, entry_closes_at)',
      )
      .eq('id', entryId)
      .eq('participant_id', participantId)
      .maybeSingle(),
    'failed to read the own entry to update',
  );
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

  // The checks above read the entry without a lock, so a cancellation in
  // another tab (or a lapse of an expired `pending_verification` entry) can
  // commit before this runs. The owner and the editable statuses are
  // therefore filtered again in the UPDATE itself: Postgres re-evaluates
  // them against the committed row, so a row cancelled in between is left
  // alone and comes back as no row (#288).
  const updated = unwrap(
    await db
      .from('entries')
      .update({
        name: patch.name,
        furigana: patch.furigana,
        display_name: patch.displayName,
        free_text: patch.freeText ?? null,
        custom_field_values: patch.customFieldValues,
      })
      .eq('id', entryId)
      .eq('participant_id', participantId)
      .in('status', EDITABLE_ENTRY_STATUSES)
      .select('id'),
    'failed to update the own entry',
  );
  if (updated.length === 0) {
    return refusedAfterRace(db, participantId, entryId);
  }
  return {ok: true};
}

/**
 * What an edit whose UPDATE matched no row answers with. The row was
 * there, owned and editable when it was checked, so it changed in between;
 * it is read again and told the way the check would tell it now, so the
 * participant sees the same message as when the form is submitted a moment
 * later.
 * @param db The database client.
 * @param participantId The logged-in participant.
 * @param entryId The entry the edit was for.
 */
async function refusedAfterRace(
  db: DbClient,
  participantId: string,
  entryId: string,
): Promise<ClientFailure<403 | 404>> {
  const entry = unwrap(
    await db
      .from('entries')
      .select('status')
      .eq('id', entryId)
      .eq('participant_id', participantId)
      .maybeSingle(),
    'failed to read the own entry after a missed update',
  );
  if (!entry) {
    return {ok: false, status: 404, error: COMMON_ERROR_CODES.ENTRY_NOT_FOUND};
  }
  return {
    ok: false,
    status: 403,
    // Editable again only if it was re-entered after the UPDATE missed it.
    // It was cancelled when the edit was made, and the edit was for the
    // entry as it was before, so it is told as cancelled all the same.
    error: isEditableEntryStatus(entry.status)
      ? ENTRY_EDIT_ERROR_CODES.ENTRY_CANCELLED
      : NOT_EDITABLE_ENTRY_CODES[entry.status],
  };
}

/**
 * Cancels one of the participant's own entries
 * (`DELETE /mypage/entries/:entryId`).
 *
 * The entry is looked up by `(id, participant_id)` so another participant's
 * entry is indistinguishable from a nonexistent one. Freeing a `confirmed`
 * seat promotes the head of the tournament's waitlist. Cancelling from the
 * waitlist itself closes the gap in the queue and also runs the promotion,
 * which promotes nobody unless an earlier, failed promotion left a seat
 * empty. Cancelling before the entry was ever verified burns its
 * outstanding verification token (see the migration).
 * Cancelling an already-cancelled entry succeeds without promoting anyone.
 * @param env The Worker bindings.
 * @param db The database client.
 * @param participantId The logged-in participant, from the session cookie.
 * @param entryId The entry to cancel.
 */
export async function cancelOwnEntry(
  env: Bindings,
  db: DbClient,
  participantId: string,
  entryId: string,
): Promise<CancelOwnEntryResult> {
  // The status change, the waitlist renumbering, and the read of the status
  // the entry had beforehand all happen inside one locked transaction, so
  // two concurrent cancellations of the same seat can't both trigger a
  // promotion (see `supabase/migrations/0006_cancel_own_entry_fn.sql`).
  const data = unwrap(
    await db.rpc('cancel_own_entry', {
      p_entry_id: entryId,
      p_participant_id: participantId,
    }),
    'failed to cancel the own entry',
  );

  const cancelled = data?.[0];
  if (!cancelled) {
    return {ok: false, status: 404, error: COMMON_ERROR_CODES.ENTRY_NOT_FOUND};
  }

  // A waitlisted entry frees no seat, but its cancellation is a cheap
  // chance to fill one an earlier promotion failed to (the promotion counts
  // the free seats, so it does nothing when there are none). A
  // `pending_verification` entry neither held a seat nor stood in the queue.
  if (
    cancelled.previous_status === 'confirmed' ||
    cancelled.previous_status === 'waitlisted'
  ) {
    try {
      // The cancellation above is already committed, so a
      // `pending_verification` entry can be confirmed before this runs. With
      // anyone waiting, `confirm_entry_by_token` queues it behind them
      // rather than into the freed seat, and `confirmEntryByToken()` runs
      // this same promotion itself (0047, #283); with nobody waiting it may
      // take the seat. Either way `promote_waitlisted_entries` -- counting
      // the free seats under its own tournament lock -- promotes nobody
      // into a seat already taken instead of pushing the tournament over
      // capacity. A mail it couldn't send is logged there.
      await promoteWaitlistedEntries(env, db, cancelled.entry_tournament_id);
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
