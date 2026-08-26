import {
  EDITABLE_ENTRY_STATUSES,
  findCustomFieldValuesError,
  isRegulationSelectionAllowed,
  isWithinEntryPeriod,
  type EntryEditInput,
  type EntryInput,
  type EntryStatus,
} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {sendVerificationEmail} from './entry-verification';
import {FORM_FIELD_DEF_COLUMNS, toFormFieldDef} from './form-field-defs';
import type {FormFieldDefRow} from './form-field-defs';
import {hashPassword, verifyPassword} from './password';
import {promoteNextWaitlistedEntry} from './waitlist';

type CreateEntryResult =
  | {ok: true; entry: {id: string}}
  | {ok: false; status: 400 | 401 | 403 | 409 | 500; error: string};

type UpdateOwnEntryResult =
  {ok: true} | {ok: false; status: 400 | 403 | 404 | 500; error: string};

type CancelOwnEntryResult =
  {ok: true} | {ok: false; status: 404 | 500; error: string};

interface RegulationRow {
  id: string;
  priority_starts_at: string | null;
  priority_ends_at: string | null;
}

interface TournamentRow {
  id: string;
  region_id: string;
  entry_opens_at: string;
  entry_closes_at: string;
  regulations: RegulationRow[];
}

interface ParticipantRow {
  id: string;
  region_id: string;
  password_hash: string;
}

/**
 * The participant's existing entry for the tournament, if there is one.
 *
 * Every column the reuse update in `createEntry()` overwrites is selected,
 * not just the ones the reuse decision is made on, so a re-entry that fails
 * afterwards can put the row back exactly as it was.
 */
interface ExistingEntryRow {
  id: string;
  name: string;
  furigana: string;
  display_name: string;
  regulation_id: string;
  free_text: string | null;
  // Same value union as `EntryInput['customFieldValues']`: every stored value
  // originated from that input shape.
  custom_field_values: Record<string, string | string[]>;
  status: EntryStatus;
  waitlist_position: number | null;
  email_verified_at: string | null;
  cancelled_at: string | null;
}

/** The columns of `ExistingEntryRow`, for the snapshot select. */
const EXISTING_ENTRY_COLUMNS =
  'id, name, furigana, display_name, regulation_id, free_text, ' +
  'custom_field_values, status, waitlist_position, email_verified_at, ' +
  'cancelled_at';

/**
 * Runs the full entry-creation flow for `POST /tournaments/:tournamentId/entries`:
 * entry-period check, regulation priority-window check, validation of the
 * custom field answers against the tournament's own form definition,
 * participant lookup/creation, password hashing, `entries` row creation
 * (reusing the participant's own cancelled row for this tournament, if any)
 * and dispatch of the verification email.
 * @param env The Worker bindings.
 * @param tournamentId The tournament being entered.
 * @param input The validated entry form submission.
 */
export async function createEntry(
  env: Bindings,
  tournamentId: string,
  input: EntryInput,
): Promise<CreateEntryResult> {
  const db = createDbClient(env);

  const {data: tournament} = await db
    .from('tournaments')
    .select(
      'id, region_id, entry_opens_at, entry_closes_at, ' +
        'regulations(id, priority_starts_at, priority_ends_at)',
    )
    .eq('id', tournamentId)
    .returns<TournamentRow[]>()
    .maybeSingle();
  if (!tournament) {
    return {ok: false, status: 400, error: 'invalid tournament'};
  }

  const now = new Date();
  if (
    !isWithinEntryPeriod(
      tournament.entry_opens_at,
      tournament.entry_closes_at,
      now,
    )
  ) {
    return {ok: false, status: 403, error: 'entry period closed'};
  }

  const regulations = tournament.regulations.map(regulation => ({
    id: regulation.id,
    priorityStartsAt: regulation.priority_starts_at,
    priorityEndsAt: regulation.priority_ends_at,
  }));
  if (!isRegulationSelectionAllowed(regulations, input.regulationId, now)) {
    return {
      ok: false,
      status: 403,
      error: 'regulation not eligible in priority window',
    };
  }

  // Checked here, before the participant lookup, so a submission the rendered
  // form could never have produced is refused without creating an account for
  // it as a side effect.
  const {data: fieldDefRows, error: fieldDefsError} = await db
    .from('form_field_defs')
    .select(FORM_FIELD_DEF_COLUMNS)
    .eq('tournament_id', tournamentId)
    .order('display_order', {ascending: true})
    .returns<FormFieldDefRow[]>();
  if (fieldDefsError) {
    return {ok: false, status: 500, error: fieldDefsError.message};
  }
  const customFieldValuesError = findCustomFieldValuesError(
    (fieldDefRows ?? []).map(toFormFieldDef),
    input.customFieldValues,
  );
  if (customFieldValuesError) {
    return {ok: false, status: 400, error: customFieldValuesError};
  }

  const {data: existingParticipant} = await db
    .from('participants')
    .select('id, region_id, password_hash')
    .eq('email', input.email)
    .returns<ParticipantRow[]>()
    .maybeSingle();
  if (
    existingParticipant &&
    existingParticipant.region_id !== tournament.region_id
  ) {
    return {
      ok: false,
      status: 409,
      error: 'already registered in another region',
    };
  }

  let participantId: string;
  if (existingParticipant) {
    // Re-entering under an already-registered email must prove ownership of
    // that account, otherwise anyone who learns a participant's email could
    // attach unauthorized entries to it.
    const passwordValid = await verifyPassword(
      input.password,
      existingParticipant.password_hash,
    );
    if (!passwordValid) {
      return {ok: false, status: 401, error: 'invalid password'};
    }
    participantId = existingParticipant.id;
  } else {
    const {data: created, error} = await db
      .from('participants')
      .insert({
        email: input.email,
        region_id: tournament.region_id,
        password_hash: await hashPassword(input.password),
      })
      .select('id')
      .single();
    if (error || !created) {
      return {
        ok: false,
        status: 409,
        error: error?.message ?? 'failed to create participant',
      };
    }
    participantId = created.id;
  }

  // A participant who cancelled may enter the same tournament again with the
  // same credentials. The unique (participant_id, tournament_id) constraint
  // means that has to reuse the cancelled row instead of inserting a second
  // one.
  const {data: existingEntry, error: existingEntryError} = await db
    .from('entries')
    .select(EXISTING_ENTRY_COLUMNS)
    .eq('participant_id', participantId)
    .eq('tournament_id', tournamentId)
    .returns<ExistingEntryRow[]>()
    .maybeSingle();
  if (existingEntryError) {
    return {ok: false, status: 500, error: existingEntryError.message};
  }
  if (existingEntry && existingEntry.status !== 'cancelled') {
    return {ok: false, status: 409, error: 'already entered'};
  }

  const entryValues = {
    participant_id: participantId,
    tournament_id: tournamentId,
    name: input.name,
    furigana: input.furigana,
    display_name: input.displayName,
    regulation_id: input.regulationId,
    free_text: input.freeText ?? null,
    custom_field_values: input.customFieldValues,
    status: 'pending_verification',
    // Explicitly reset on reuse, so a re-entry starts from exactly the state
    // a freshly inserted row would: unverified, unplaced on the waitlist and
    // no longer carrying the previous cancellation.
    waitlist_position: null,
    email_verified_at: null,
    cancelled_at: null,
  };

  const {data: entry, error} = existingEntry
    ? await db
        .from('entries')
        // Still filtered on `cancelled`, so two concurrent re-entries behave
        // like two concurrent first entries: the second one matches no row
        // and is refused instead of mailing a second verification link for
        // the same entry.
        .update(entryValues)
        .eq('id', existingEntry.id)
        .eq('status', 'cancelled')
        .select('id')
        .single()
    : await db.from('entries').insert(entryValues).select('id').single();
  if (error || !entry) {
    return {
      ok: false,
      status: 409,
      error: error?.message ?? 'failed to create entry',
    };
  }

  try {
    await sendVerificationEmail(env, entry.id, input.email);
  } catch (mailError) {
    // Roll back the entry: leaving it in place would permanently block a
    // retry — on the unique (participant_id, tournament_id) constraint for a
    // new row, or on the 'already entered' check above for a reused one —
    // even though the participant never received a usable verification link.
    // The verification tokens go first: the entry can't be deleted while
    // they reference it by foreign key, and on the reuse path dropping them
    // is what stops a link that did go out from confirming an entry that has
    // been put back into its cancellation.
    await db
      .from('email_verification_tokens')
      .delete()
      .eq('entry_id', entry.id);
    if (existingEntry) {
      // A reused row is put back into the cancellation it came from rather
      // than deleted, so a failed re-entry doesn't erase the record of the
      // original entry. Every column the reuse update overwrote is restored
      // from the snapshot taken before it: restoring only the status would
      // still leave the cancelled entry permanently carrying the failed
      // re-entry's answers and its cleared verification timestamp.
      await db
        .from('entries')
        .update({
          name: existingEntry.name,
          furigana: existingEntry.furigana,
          display_name: existingEntry.display_name,
          regulation_id: existingEntry.regulation_id,
          free_text: existingEntry.free_text,
          custom_field_values: existingEntry.custom_field_values,
          status: existingEntry.status,
          waitlist_position: existingEntry.waitlist_position,
          email_verified_at: existingEntry.email_verified_at,
          cancelled_at: existingEntry.cancelled_at,
        })
        .eq('id', entry.id);
    } else {
      await db.from('entries').delete().eq('id', entry.id);
    }
    const message =
      mailError instanceof Error ? mailError.message : 'unknown error';
    return {
      ok: false,
      status: 500,
      error: `failed to send verification email: ${message}`,
    };
  }
  return {ok: true, entry: {id: entry.id}};
}

/** Shape of the ownership/entry-period lookup in `updateOwnEntry()`. */
interface OwnEntryRow {
  id: string;
  tournament_id: string;
  status: EntryStatus;
  tournaments: {
    entry_opens_at: string;
    entry_closes_at: string;
  };
}

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
      'id, tournament_id, status, ' +
        'tournaments(entry_opens_at, entry_closes_at)',
    )
    .eq('id', entryId)
    .eq('participant_id', participantId)
    .returns<OwnEntryRow[]>()
    .maybeSingle();
  // A failed lookup must not be reported as a missing entry: that would hide
  // a database/network outage behind a 404.
  if (lookupError) {
    return {ok: false, status: 500, error: lookupError.message};
  }
  if (!entry) {
    return {ok: false, status: 404, error: 'entry not found'};
  }

  if (
    !isWithinEntryPeriod(
      entry.tournaments.entry_opens_at,
      entry.tournaments.entry_closes_at,
    )
  ) {
    return {ok: false, status: 403, error: 'entry period closed'};
  }
  if (!EDITABLE_ENTRY_STATUSES.includes(entry.status)) {
    return {ok: false, status: 403, error: `entry is ${entry.status}`};
  }

  const {data: fieldDefRows, error: fieldDefsError} = await db
    .from('form_field_defs')
    .select(FORM_FIELD_DEF_COLUMNS)
    .eq('tournament_id', entry.tournament_id)
    .order('display_order', {ascending: true})
    .returns<FormFieldDefRow[]>();
  if (fieldDefsError) {
    return {ok: false, status: 500, error: fieldDefsError.message};
  }
  const customFieldValuesError = findCustomFieldValuesError(
    (fieldDefRows ?? []).map(toFormFieldDef),
    patch.customFieldValues,
  );
  if (customFieldValuesError) {
    return {ok: false, status: 400, error: customFieldValuesError};
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

/** Shape of the row `cancel_own_entry` returns. */
interface CancelledEntryRow {
  previous_status: EntryStatus;
  entry_tournament_id: string;
}

/**
 * Cancels one of the participant's own entries
 * (`DELETE /mypage/entries/:entryId`).
 *
 * The entry is looked up by `(id, participant_id)` so another participant's
 * entry is indistinguishable from a nonexistent one. Freeing a `confirmed`
 * seat promotes the head of the tournament's waitlist, unless another entry
 * confirmed into that seat first; cancelling from the waitlist itself only
 * closes the gap in the queue, and cancelling before the entry was ever
 * verified burns its outstanding verification token (see the migration).
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

  // `db` isn't constructed with generated Database types (see `./db`), so
  // the SETOF row shape has to be asserted here — same as in `./waitlist`.
  const cancelled = (data as CancelledEntryRow[] | null)?.[0];
  if (!cancelled) {
    return {ok: false, status: 404, error: 'entry not found'};
  }

  if (cancelled.previous_status === 'confirmed') {
    try {
      // The cancellation above is already committed, so a
      // `pending_verification` entry can confirm into the freed seat before
      // this runs. `promote_next_waitlisted_entry` therefore re-checks
      // capacity under its own tournament lock and promotes nobody when the
      // seat has been taken, instead of pushing the tournament over capacity.
      await promoteNextWaitlistedEntry(env, cancelled.entry_tournament_id);
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
