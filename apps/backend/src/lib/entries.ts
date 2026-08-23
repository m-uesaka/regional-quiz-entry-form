import {
  isRegulationSelectionAllowed,
  isWithinEntryPeriod,
  type EntryInput,
} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {sendVerificationEmail} from './entry-verification';
import {hashPassword, verifyPassword} from './password';

type CreateEntryResult =
  | {ok: true; entry: {id: string}}
  | {ok: false; status: 400 | 401 | 403 | 409 | 500; error: string};

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
