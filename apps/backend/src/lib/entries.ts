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
  // A to-one embed, so PostgREST answers with the region object itself
  // rather than a single-element array (unlike `regulations` below).
  regions: {allows_dual_entry: boolean};
  regulations: RegulationRow[];
}

/**
 * The error the dual-entry rule answers with. Shared with the trigger's
 * SQLSTATE mapping below so both paths give the entry form the same string
 * to translate.
 */
const ALREADY_ENTERED_ANOTHER_TOURNAMENT =
  'already entered another tournament in this region';

/**
 * What a refused `entry_regulations` write answers with. Reached only when
 * a regulation the submission named stopped existing between
 * `isRegulationSelectionAllowed()` and the write — a `sync_regulations()`
 * call that dropped it — so it is a conflict with a concurrent change, not
 * a malformed submission. Spelled out rather than passing the constraint
 * violation through, so the entry form has something stable to translate.
 */
const REGULATION_NO_LONGER_AVAILABLE = 'regulation no longer available';

/**
 * The SQLSTATE `check_region_dual_entry()` (migration 0016) raises. The
 * trigger only fires for a submission that slipped through the check below
 * while a concurrent one was being inserted, so it is a race, not a bug in
 * the caller — but the participant caused it and 409 is still the honest
 * answer.
 */
const REGION_DUAL_ENTRY_SQLSTATE = 'P0005';

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
  // The row's own regulation selection, as a to-many embed. Restored as a
  // whole on rollback, because the reuse path replaces the set rather than
  // editing it in place.
  entry_regulations: Array<{regulation_id: string}>;
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
  'id, name, furigana, display_name, entry_regulations(regulation_id), ' +
  'free_text, custom_field_values, status, waitlist_position, ' +
  'email_verified_at, cancelled_at';

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
  db: ReturnType<typeof createDbClient>,
  entryId: string,
  tournamentId: string,
  regulationIds: readonly string[],
): Promise<{error: {message: string} | null}> {
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
async function rollbackEntry(
  db: ReturnType<typeof createDbClient>,
  entryId: string,
  tournamentId: string,
  existingEntry: ExistingEntryRow | null,
): Promise<void> {
  // The verification tokens go first: the entry can't be deleted while they
  // reference it by foreign key, and on the reuse path dropping them is what
  // stops a link that did go out from confirming an entry that has been put
  // back into its cancellation.
  await db.from('email_verification_tokens').delete().eq('entry_id', entryId);

  if (!existingEntry) {
    // `entry_regulations` references the entry `on delete cascade`, so the
    // selection written for it goes with the row.
    await db.from('entries').delete().eq('id', entryId);
    return;
  }

  // A reused row is put back into the cancellation it came from rather than
  // deleted, so a failed re-entry doesn't erase the record of the original
  // entry. Every column the reuse update overwrote is restored from the
  // snapshot taken before it: restoring only the status would still leave
  // the cancelled entry permanently carrying the failed re-entry's answers
  // and its cleared verification timestamp.
  await db
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
      cancelled_at: existingEntry.cancelled_at,
    })
    .eq('id', entryId);
  // The regulation selection lives in its own table, so it is rewritten
  // rather than restored by the update above.
  await replaceEntryRegulations(
    db,
    entryId,
    tournamentId,
    existingEntry.entry_regulations.map(row => row.regulation_id),
  );
}

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

  const {data: tournament, error: tournamentError} = await db
    .from('tournaments')
    .select(
      'id, region_id, entry_opens_at, entry_closes_at, ' +
        'regions(allows_dual_entry), ' +
        'regulations(id, priority_starts_at, priority_ends_at)',
    )
    .eq('id', tournamentId)
    .returns<TournamentRow[]>()
    .maybeSingle();
  // A failing select is not the same as an unknown tournament: the embeds
  // read columns added by later migrations, so a stale PostgREST schema
  // cache would otherwise turn every submission into 「大会が見つかりません」
  // with nothing logged. Kept apart so the 500 says so.
  if (tournamentError) {
    return {ok: false, status: 500, error: tournamentError.message};
  }
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
  if (!isRegulationSelectionAllowed(regulations, input.regulationIds, now)) {
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
    return {ok: false, status: 400, error: customFieldValuesError.message};
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

  // requirements.md only says that regions allowing both 最強位 and 新人王
  // exist, so the region decides. Where it doesn't allow both, an entry in
  // the region's *other* tournament blocks this one. `tournament_id` is
  // excluded rather than the whole region matched loosely, so re-entering
  // this same tournament after cancelling still goes through — that row was
  // already checked above.
  if (!tournament.regions.allows_dual_entry) {
    const {count, error: dualEntryError} = await db
      .from('entries')
      .select('id, tournaments!inner(region_id)', {count: 'exact', head: true})
      .eq('participant_id', participantId)
      .eq('tournaments.region_id', tournament.region_id)
      .neq('tournament_id', tournamentId)
      // Every status but `cancelled` occupies the region, expressed by
      // exclusion rather than by listing the occupying ones: a status added
      // to the `entry_status` enum later would otherwise fall out of the
      // list silently and re-open double entry. `pending_verification`
      // counts on purpose — it is a seat held before the mail was
      // confirmed, and skipping it would let a participant hold both
      // tournaments by simply never following the link.
      .neq('status', 'cancelled');
    if (dualEntryError) {
      return {ok: false, status: 500, error: dualEntryError.message};
    }
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        status: 409,
        error: ALREADY_ENTERED_ANOTHER_TOURNAMENT,
      };
    }
  }

  const entryValues = {
    participant_id: participantId,
    tournament_id: tournamentId,
    name: input.name,
    furigana: input.furigana,
    display_name: input.displayName,
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
  if (error?.code === REGION_DUAL_ENTRY_SQLSTATE) {
    // The check above lost a race with a concurrent submission for the
    // region's other tournament; the trigger is what actually kept the
    // participant from holding both seats.
    return {ok: false, status: 409, error: ALREADY_ENTERED_ANOTHER_TOURNAMENT};
  }
  if (error || !entry) {
    return {
      ok: false,
      status: 409,
      error: error?.message ?? 'failed to create entry',
    };
  }

  // The selection is written after the entry because it references it. The
  // composite foreign keys behind `entry_regulations` are what refuse a
  // regulation belonging to another tournament, so a submission that got
  // past `isRegulationSelectionAllowed()` on a regulation list
  // `sync_regulations()` deleted from under it is stopped here rather than
  // stored — which is why a failure rolls the entry back instead of leaving
  // one claiming nothing.
  const {error: regulationsError} = await replaceEntryRegulations(
    db,
    entry.id,
    tournamentId,
    input.regulationIds,
  );
  if (regulationsError) {
    console.error('failed to store the entry regulations', {
      entryId: entry.id,
      error: regulationsError.message,
    });
    await rollbackEntry(db, entry.id, tournamentId, existingEntry);
    return {ok: false, status: 409, error: REGULATION_NO_LONGER_AVAILABLE};
  }

  try {
    await sendVerificationEmail(env, entry.id, input.email);
  } catch (mailError) {
    // Rolled back because the participant never received a usable
    // verification link, so the entry they can't confirm must not stand in
    // the way of them trying again.
    await rollbackEntry(db, entry.id, tournamentId, existingEntry);
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
    return {ok: false, status: 400, error: customFieldValuesError.message};
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
