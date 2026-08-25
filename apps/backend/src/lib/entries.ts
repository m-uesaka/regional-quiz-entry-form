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

type CreateEntryResult =
  | {ok: true; entry: {id: string}}
  | {ok: false; status: 400 | 401 | 403 | 409 | 500; error: string};

type UpdateOwnEntryResult =
  {ok: true} | {ok: false; status: 400 | 403 | 404 | 500; error: string};

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
 * Runs the full entry-creation flow for `POST /tournaments/:tournamentId/entries`:
 * entry-period check, regulation priority-window check, participant
 * lookup/creation, password hashing, `entries` row creation, and dispatch of
 * the verification email.
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

  const {data: entry, error} = await db
    .from('entries')
    .insert({
      participant_id: participantId,
      tournament_id: tournamentId,
      name: input.name,
      furigana: input.furigana,
      display_name: input.displayName,
      regulation_id: input.regulationId,
      free_text: input.freeText ?? null,
      custom_field_values: input.customFieldValues,
      status: 'pending_verification',
    })
    .select('id')
    .single();
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
    // retry on the unique (participant_id, tournament_id) constraint even
    // though the participant never received a usable verification link. The
    // verification token (if one was persisted before the mail send failed)
    // must be removed first since it references the entry by foreign key.
    await db
      .from('email_verification_tokens')
      .delete()
      .eq('entry_id', entry.id);
    await db.from('entries').delete().eq('id', entry.id);
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

  const {data: entry} = await db
    .from('entries')
    .select(
      'id, tournament_id, status, ' +
        'tournaments(entry_opens_at, entry_closes_at)',
    )
    .eq('id', entryId)
    .eq('participant_id', participantId)
    .returns<OwnEntryRow[]>()
    .maybeSingle();
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
