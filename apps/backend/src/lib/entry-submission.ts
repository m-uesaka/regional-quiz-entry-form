/**
 * @fileoverview Entry submissions: checking one against its tournament
 * (`checkEntrySubmission()`), settling whose it is, writing the entry and
 * rolling it back when a later step fails, and -- for the unauthenticated
 * route -- turning a refusal into the notice mailed to the address instead.
 * Editing or cancelling an entry once made is `own-entries.ts`.
 */

import {
  COMMON_ERROR_CODES,
  ENTRY_ERROR_CODES,
  entryAvailability,
  isEntryErrorCode,
  regulationSelectionRefusal,
  type EntryErrorCode,
  type EntryInput,
  type EntrySessionInput,
  type RegulationSelectionRefusal,
} from '@regional-quiz/shared';
import {isCommonPassword} from '@regional-quiz/shared/password-policy';
import type {Bindings} from '../types/env';
import {
  createDbClient,
  type DbClient,
  type Tables,
  type TablesInsert,
} from './db';
import {sendEntryNoticeEmail, type EntryNoticeReason} from './entry-notice';
import {
  holdForDeferredVerification,
  sendVerificationEmail,
} from './entry-verification';
import {deferEntryMail} from './deferred-entry-mail';
import type {InternalFailure, LibFailure} from './errors';
import {validateCustomFieldValues} from './form-field-defs';
import {hashPassword, verifyPassword} from './password';
import {
  FOREIGN_KEY_VIOLATION_SQLSTATE,
  NO_ROW_PGRST_CODE,
  PARTICIPANT_REGION_SQLSTATE,
  REGION_DUAL_ENTRY_SQLSTATE,
  UNIQUE_VIOLATION_SQLSTATE,
} from './pg-errors';
import {tournamentDisplayName} from './tournaments';
import {verifyAccountPassword} from './password-rehash';

type CreateEntryResult =
  {ok: true; entry: {id: string}} | LibFailure<400 | 401 | 403 | 409>;

/**
 * What the address-independent half of an entry submission concluded: the
 * tournament it can go on to enter, or why it can't.
 */
export type EntrySubmissionCheck =
  {ok: true; tournament: EntryTournamentRow} | LibFailure<400 | 403 | 409>;

/**
 * What an unauthenticated entry submission came to, once it has run in the
 * background (`createEntryUnauthenticated()`). Never sent to the client,
 * whose answer is the same whichever of these it was.
 */
export type CreateEntryOutcome =
  | {kind: 'created'; entryId: string}
  | {kind: 'notified'; reason: EntryNoticeReason}
  | {kind: 'failed'; error: string};

/**
 * The tournament an entry submission is checked against. `capacity` is null
 * for an uncapped tournament, which can never waitlist anyone.
 */
export interface EntryTournamentRow extends Pick<
  Tables<'tournaments'>,
  | 'id'
  | 'name'
  | 'type'
  | 'region_id'
  | 'capacity'
  | 'entry_opens_at'
  | 'entry_closes_at'
  | 'entries_paused'
> {
  // A to-one embed, so PostgREST answers with the region object itself
  // rather than a single-element array (unlike `regulations` below).
  regions: Pick<Tables<'regions'>, 'name'>;
  regulations: Array<
    Pick<
      Tables<'regulations'>,
      'id' | 'priority_starts_at' | 'priority_ends_at' | 'closes_with_priority'
    >
  >;
}

/**
 * What each way of refusing a regulation selection answers with. Naming what
 * isn't on offer is a conflict with a change, which choosing again fixes; the
 * rest are a selection the form wouldn't send.
 */
const REGULATION_REFUSALS: Record<
  RegulationSelectionRefusal,
  {status: 403 | 409; error: EntryErrorCode}
> = {
  empty: {status: 403, error: ENTRY_ERROR_CODES.REGULATION_NOT_ELIGIBLE},
  'needs-priority': {
    status: 403,
    error: ENTRY_ERROR_CODES.REGULATION_NOT_ELIGIBLE,
  },
  'not-offered': {
    status: 409,
    error: ENTRY_ERROR_CODES.REGULATION_NO_LONGER_AVAILABLE,
  },
};

/**
 * A participant as `PARTICIPANT_COLUMNS` selects it. `email_verified_at` is
 * null until the owner of the address follows a verification link (migration
 * 0034, #189).
 */
type ParticipantRow = Pick<
  Tables<'participants'>,
  'id' | 'region_id' | 'password_hash' | 'email_verified_at'
>;

/** What `ParticipantRow` is selected with. */
const PARTICIPANT_COLUMNS = 'id, region_id, password_hash, email_verified_at';

/**
 * The participant's existing entry for the tournament, if there is one.
 *
 * Every column `reenter_cancelled_entry()` (migrations 0041, 0052) overwrites is
 * selected, not just the ones the reuse decision is made on, so a re-entry
 * that fails afterwards can put the row back exactly as it was. A column added
 * to that function's `set` list has to be added here and to `rollbackEntry()`.
 */
interface ExistingEntryRow extends Pick<
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
async function rollbackEntry(
  db: DbClient,
  entryId: string,
  tournamentId: string,
  existingEntry: ExistingEntryRow | null,
): Promise<void> {
  // The verification tokens go first: the entry can't be deleted while they
  // reference it by foreign key, and on the reuse path dropping them is what
  // stops a link that did go out from confirming an entry that has been put
  // back into its cancellation.
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
 * Runs the full entry-creation flow for an address-and-password submission,
 * reporting every refusal as it happens: entry-period check, regulation
 * priority-window check, validation of the custom field answers against the
 * tournament's own form definition, participant lookup/creation, password
 * hashing, `entries` row creation (reusing the participant's own cancelled
 * row for this tournament, if any) and dispatch of the verification email.
 *
 * Not what `POST /tournaments/:tournamentId/entries` answers with: reporting
 * "wrong password" or "taking part in another region" to whoever submitted
 * would tell them whether an address is registered (#117). The route runs
 * `checkEntrySubmission()` up front and hands the rest to
 * `createEntryUnauthenticated()` in the background.
 * @param env The Worker bindings.
 * @param tournamentId The tournament being entered.
 * @param input The validated entry form submission.
 */
export async function createEntry(
  env: Bindings,
  tournamentId: string,
  input: EntryInput,
): Promise<CreateEntryResult> {
  const check = await checkEntrySubmission(env, tournamentId, input);
  if (!check.ok) {
    return check;
  }
  return createEntryAfterCheck(env, check.tournament, input);
}

/**
 * The half of an entry submission that doesn't depend on whose it is: the
 * tournament exists and is taking entries, the regulations chosen are
 * allowed right now, and the custom field answers fit the tournament's own
 * form. Nothing here reads `participants`, so its answer -- and how long it
 * takes to give it -- says nothing about the address being entered under,
 * which is what lets the unauthenticated route report these refusals
 * directly while keeping everything after them to itself (#117).
 * @param env The Worker bindings.
 * @param tournamentId The tournament being entered.
 * @param submission The parts of the submission checked here.
 */
export async function checkEntrySubmission(
  env: Bindings,
  tournamentId: string,
  submission: Pick<EntrySessionInput, 'regulationIds' | 'customFieldValues'>,
): Promise<EntrySubmissionCheck> {
  const db = createDbClient(env);

  const {data: tournament, error: tournamentError} = await db
    .from('tournaments')
    .select(
      `
        id, name, type, region_id, capacity, entry_opens_at, entry_closes_at,
        entries_paused,
        regions(name),
        regulations(id, priority_starts_at, priority_ends_at,
        closes_with_priority)
      `,
    )
    .eq('id', tournamentId)
    .maybeSingle();
  // A failing select is not the same as an unknown tournament: a stale
  // PostgREST schema cache or an outage would otherwise turn every submission
  // into 「大会が見つかりません」 with nothing logged. Kept apart so the 500
  // says so.
  if (tournamentError) {
    return {ok: false, status: 500, error: tournamentError.message};
  }
  if (!tournament) {
    return {
      ok: false,
      status: 400,
      error: ENTRY_ERROR_CODES.INVALID_TOURNAMENT,
    };
  }

  const now = new Date();
  // The same reading as the gate in front of the route. A pause by staff
  // (0039) stops only new entries: edits, cancellations and confirmations of
  // entries already made go on.
  const availability = entryAvailability(
    {
      entryOpensAt: tournament.entry_opens_at,
      entryClosesAt: tournament.entry_closes_at,
      entriesPaused: tournament.entries_paused,
    },
    now,
  );
  if (availability === 'paused') {
    return {ok: false, status: 403, error: ENTRY_ERROR_CODES.ENTRIES_PAUSED};
  }
  if (availability !== 'open') {
    return {
      ok: false,
      status: 403,
      error: ENTRY_ERROR_CODES.ENTRY_PERIOD_CLOSED,
    };
  }

  const regulations = tournament.regulations.map(regulation => ({
    id: regulation.id,
    priorityStartsAt: regulation.priority_starts_at,
    priorityEndsAt: regulation.priority_ends_at,
    closesWithPriority: regulation.closes_with_priority,
  }));
  const regulationRefusal = regulationSelectionRefusal(
    regulations,
    submission.regulationIds,
    now,
  );
  if (regulationRefusal) {
    return {ok: false, ...REGULATION_REFUSALS[regulationRefusal]};
  }

  // Checked here, before the participant lookup, so a submission the rendered
  // form could never have produced is refused without creating an account for
  // it as a side effect.
  const customFieldValuesCheck = await validateCustomFieldValues(
    db,
    tournamentId,
    submission.customFieldValues,
  );
  if (!customFieldValuesCheck.ok) {
    return customFieldValuesCheck;
  }
  return {ok: true, tournament};
}

/**
 * The address-dependent half of `createEntry()`, for a submission that
 * already passed `checkEntrySubmission()`: finds or creates the participant
 * the address belongs to and enters them.
 *
 * A participant whose address has been verified must prove ownership by
 * password, and can't enter tournaments of two regions using the same
 * question set. One whose address never was (#189) is taken over instead:
 * the account was made by a submission nobody has confirmed, possibly from
 * someone who typed another person's address to lock them into a far
 * region, so its password and region carry no weight. The submission at
 * hand replaces them, the same way it would have created the account had it
 * come first -- unless it comes with the account's own password, which
 * makes it a further entry from whoever made the account, held to the same
 * rules as a verified one (see `enterUnverifiedAccountAgain()`).
 * @param env The Worker bindings.
 * @param tournament The checked tournament.
 * @param input The validated entry form submission.
 */
async function createEntryAfterCheck(
  env: Bindings,
  tournament: EntryTournamentRow,
  input: EntryInput,
  delivery: EntryMailDelivery = 'now',
): Promise<CreateEntryResult> {
  const db = createDbClient(env);

  const {data: existingParticipant, error: participantError} = await db
    .from('participants')
    .select(PARTICIPANT_COLUMNS)
    .eq('email', input.email)
    .maybeSingle();
  if (participantError) {
    return {ok: false, status: 500, error: participantError.message};
  }

  if (
    existingParticipant?.email_verified_at === null &&
    (await isUnverifiedAccountPassword(existingParticipant, input.password))
  ) {
    return enterUnverifiedAccountAgain(
      env,
      db,
      tournament,
      existingParticipant,
      input,
      delivery,
    );
  }

  if (!existingParticipant || existingParticipant.email_verified_at === null) {
    // Whoever this account is about to belong to is setting its password,
    // so they are held to the rules for setting one. The form's own schema
    // can't apply them (the same field is how a returning participant proves
    // an older password), and doing it here keeps the refusal behind the
    // address like every other answer that depends on it.
    if (isCommonPassword(input.password)) {
      return {ok: false, status: 400, error: ENTRY_ERROR_CODES.COMMON_PASSWORD};
    }
    const passwordHash = await hashPassword(input.password);
    if (!existingParticipant) {
      const {data: created, error} = await db
        .from('participants')
        .insert({
          email: input.email,
          region_id: tournament.region_id,
          password_hash: passwordHash,
        })
        .select('id')
        .single();
      // A concurrent submission inserted the same address first.
      if (error?.code === UNIQUE_VIOLATION_SQLSTATE) {
        return {
          ok: false,
          status: 409,
          error: ENTRY_ERROR_CODES.CONCURRENT_SUBMISSION,
        };
      }
      if (error || !created) {
        // Anything else is a fault on our side, and its message describes
        // the database: a 500 keeps it in the log (#191).
        return {
          ok: false,
          status: 500,
          error: error?.message ?? 'failed to create participant',
        };
      }
      return enterTournament(
        env,
        tournament,
        created.id,
        input.email,
        input,
        {passwordHash},
        delivery,
      );
    }
    // A different password: the account is handed to
    // this submission, and what the earlier ones made goes with the old
    // password (see the migration for why it is deleted rather than kept).
    const {data: withdrawn, error: takeOverError} = await db.rpc(
      'take_over_unverified_participant',
      {
        p_participant_id: existingParticipant.id,
        p_password_hash: passwordHash,
        p_region_id: tournament.region_id,
      },
    );
    if (takeOverError) {
      return {ok: false, status: 500, error: takeOverError.message};
    }
    // Null when the address turned out to be verified (see below).
    if (withdrawn !== null) {
      return enterTournament(
        env,
        tournament,
        existingParticipant.id,
        input.email,
        input,
        {
          passwordHash,
          withdrawnTournaments: await withdrawnTournamentNames(
            db,
            withdrawn.filter(id => id !== tournament.id),
          ),
        },
        delivery,
      );
    }
    // The address was verified since it was read above -- its owner
    // followed a link a moment ago -- so the account is theirs now, and
    // this submission is held to it like any other. Read again, because
    // what the takeover found verified need not be the row read above:
    // another submission may have taken the account over in between, and
    // had its own link followed, leaving another password and region.
    const {data: verifiedParticipant, error: rereadError} = await db
      .from('participants')
      .select(PARTICIPANT_COLUMNS)
      .eq('id', existingParticipant.id)
      .single();
    if (rereadError || !verifiedParticipant) {
      return {
        ok: false,
        status: 500,
        error: rereadError?.message ?? 'failed to read the participant',
      };
    }
    return enterVerifiedParticipant(
      env,
      tournament,
      verifiedParticipant,
      input,
      delivery,
    );
  }

  return enterVerifiedParticipant(
    env,
    tournament,
    existingParticipant,
    input,
    delivery,
  );
}

/**
 * Enters a submission into a participant whose address has been verified,
 * once it proves the account's password.
 * @param env The Worker bindings.
 * @param tournament The checked tournament.
 * @param participant The verified participant, as last read.
 * @param input The validated entry form submission.
 */
async function enterVerifiedParticipant(
  env: Bindings,
  tournament: EntryTournamentRow,
  participant: ParticipantRow,
  input: EntryInput,
  delivery: EntryMailDelivery,
): Promise<CreateEntryResult> {
  // Re-entering under a verified address must prove ownership of that
  // account, otherwise anyone who learns a participant's email could attach
  // unauthorized entries to it.
  //
  // A correct password on an older hash is upgraded the same way the login
  // does it (`verifyAccountPassword()`): some participants only ever come
  // back through this form, and their hash would otherwise never move.
  // Awaited rather than handed to `waitUntil()` because the
  // address-and-password route already runs all of this after its response
  // (#117); it never rejects, so the entry goes ahead whatever happens to it.
  let upgrade: Promise<void> | undefined;
  const valid = await verifyAccountPassword(
    env,
    'participants',
    participant,
    input.password,
    pending => {
      upgrade = pending;
    },
  );
  if (!valid) {
    return {ok: false, status: 401, error: ENTRY_ERROR_CODES.INVALID_PASSWORD};
  }
  await upgrade;
  return enterTournament(
    env,
    tournament,
    participant.id,
    input.email,
    input,
    undefined,
    delivery,
  );
}

/**
 * Whether `password` is the password of an unverified account.
 *
 * Not `verifyAccountPassword()`: that would also move an older hash to the
 * current parameters, and the hash of an unverified account is what
 * `isStillUnverifiedAccountOf()` compares against to tell whether a later
 * submission took the account over in the meantime -- an upgrade made here
 * would read as exactly that. The account is either taken over or verified
 * before long, and the upgrade can wait for a login after that.
 * @param account The unverified account.
 * @param password The submitted password.
 */
async function isUnverifiedAccountPassword(
  account: ParticipantRow,
  password: string,
): Promise<boolean> {
  return (await verifyPassword(password, account.password_hash)).valid;
}

/**
 * Enters an unverified account submitted again with its own password:
 * whoever made the account is still the one submitting, so there is nothing
 * to take over, and the entries they made earlier stand -- a participant
 * entering both of a region's tournaments, or tournaments of two regions
 * using different question sets, before following any link keeps them all.
 * Every link of the account still belongs to a submission made with its
 * current password.
 *
 * A tournament the account's entries rule out -- another region's on the
 * same question set (`participant_holds_conflicting_region()`) -- is refused
 * as it would be for a verified account, rather than taken over: a takeover
 * would delete the account's other entries too, including those this
 * tournament doesn't conflict with. The check is the database's own, asked
 * whatever the region (question sets are per tournament, so the account's
 * own region can conflict too), and after expired links are lapsed, as
 * `enterTournament()` would, so that an entry that can never be confirmed
 * doesn't count. It is read without the participant's lock;
 * `check_entry_seat()` decides again under it.
 * @param env The Worker bindings.
 * @param db The Supabase client to use.
 * @param tournament The checked tournament.
 * @param account The unverified account.
 * @param input The validated entry form submission.
 */
async function enterUnverifiedAccountAgain(
  env: Bindings,
  db: DbClient,
  tournament: EntryTournamentRow,
  account: ParticipantRow,
  input: EntryInput,
  delivery: EntryMailDelivery,
): Promise<CreateEntryResult> {
  const lapsed = await lapseExpiredPendingEntries(db, account.id);
  if (!lapsed.ok) {
    return lapsed;
  }
  const {data: conflicting, error} = await db.rpc(
    'participant_holds_conflicting_region',
    {p_participant_id: account.id, p_tournament_id: tournament.id},
  );
  if (error) {
    return {ok: false, status: 500, error: error.message};
  }
  if (conflicting) {
    return {
      ok: false,
      status: 409,
      error: ENTRY_ERROR_CODES.ALREADY_REGISTERED_IN_ANOTHER_REGION,
    };
  }
  return enterTournament(
    env,
    tournament,
    account.id,
    input.email,
    input,
    {passwordHash: account.password_hash},
    delivery,
  );
}

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
async function withdrawnTournamentNames(
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
 * Enters a participant whose identity is already settled -- by password in
 * `createEntryAfterCheck()`, or by session in `createEntryForParticipant()`
 * -- into a checked tournament: lapses their entries whose verification
 * link expired unused, reuses their own cancelled entry if there is one,
 * moves them to the tournament's region unless they are taking part in
 * another one, writes the entry -- which is what the region's dual-entry
 * rule refuses, by trigger -- and its regulations and mails the verification
 * link.
 *
 * Each of those steps is a stage function below, run in that order, and the
 * first one to refuse ends the submission. A stage only reports its
 * failure: when one after the write fails, this function rolls the entry
 * back (`rollbackEntry()`), once, for all of them.
 * @param env The Worker bindings.
 * @param tournament The checked tournament.
 * @param participantId The participant being entered.
 * @param email The participant's address, where the link is sent.
 * @param input The entry itself.
 * @param delivery Whether the verification link is mailed now, or
 *     deferred for the address's limit (#346; see `EntryMailDelivery`).
 * @param unverifiedAccount For a participant whose address is not verified
 *     yet, the password hash this submission just gave the account (see
 *     `isStillUnverifiedAccountOf()` for what it guards against) and, when
 *     it took the account over, the tournaments whose pending entries that
 *     withdrew (see `withdrawnTournamentNames()`).
 */
async function enterTournament(
  env: Bindings,
  tournament: EntryTournamentRow,
  participantId: string,
  email: string,
  input: EntrySessionInput,
  unverifiedAccount?: {
    passwordHash: string;
    withdrawnTournaments?: string[];
  },
  delivery: EntryMailDelivery = 'now',
): Promise<CreateEntryResult> {
  const db = createDbClient(env);
  const tournamentId = tournament.id;

  const lapsed = await lapseExpiredPendingEntries(db, participantId);
  if (!lapsed.ok) {
    return lapsed;
  }

  const reusable = await findReusableEntry(db, participantId, tournamentId);
  if (!reusable.ok) {
    return reusable;
  }
  const {existingEntry} = reusable;

  // Taking part in another region on the same question set is what stops an
  // entry here, not having registered in one: a participant who cancelled
  // there in time can enter here (#236), and the account follows. Only a
  // verified participant gets here unsettled, once proved by password or
  // session, so a stranger's submission can't move an account; an
  // unverified account's region was settled when it was made or taken over,
  // and claiming it again on a stale read could undo a takeover. An entry
  // that then fails leaves the account moved, which is harmless: with
  // nothing holding it, it can move again.
  if (!unverifiedAccount) {
    const claimed = await claimTournamentRegion(
      db,
      participantId,
      tournamentId,
    );
    if (!claimed.ok) {
      return claimed;
    }
  }

  const written = await writeEntry(
    db,
    participantId,
    tournamentId,
    input,
    existingEntry,
  );
  if (!written.ok) {
    return written;
  }
  const {entryId} = written;

  const completed = await completeWrittenEntry(
    env,
    db,
    entryId,
    participantId,
    email,
    tournament,
    input,
    unverifiedAccount,
    delivery,
  );
  if (!completed.ok) {
    // Rolled back here, and only here, for every stage after the write: a
    // refused submission must not leave behind an entry that would block
    // its own retry (see `rollbackEntry()`).
    await rollbackEntry(db, entryId, tournamentId, existingEntry);
    return completed;
  }
  return {ok: true, entry: {id: entryId}};
}

/**
 * The stages of `enterTournament()` that run over the entry `writeEntry()`
 * wrote: stores its regulations, checks that a later submission hasn't
 * taken the unverified account over meanwhile, and mails the verification
 * link. The first one to refuse ends the run; rolling the entry back is
 * left to the caller.
 * @param env The Worker bindings.
 * @param db The Supabase client to write with.
 * @param entryId The entry `writeEntry()` wrote.
 * @param participantId The participant being entered.
 * @param email The participant's address, where the link is sent.
 * @param tournament The checked tournament.
 * @param input The entry itself.
 * @param unverifiedAccount As for `enterTournament()`.
 */
async function completeWrittenEntry(
  env: Bindings,
  db: DbClient,
  entryId: string,
  participantId: string,
  email: string,
  tournament: EntryTournamentRow,
  input: EntrySessionInput,
  unverifiedAccount:
    {passwordHash: string; withdrawnTournaments?: string[]} | undefined,
  delivery: EntryMailDelivery,
): Promise<{ok: true} | LibFailure<409>> {
  const stored = await storeEntryRegulations(
    db,
    entryId,
    tournament.id,
    input.regulationIds,
  );
  if (!stored.ok) {
    return stored;
  }

  if (unverifiedAccount) {
    const current = await ensureStillUnverifiedAccountOf(
      db,
      participantId,
      unverifiedAccount.passwordHash,
    );
    if (!current.ok) {
      return current;
    }
  }

  return mailVerificationLink(
    env,
    entryId,
    email,
    tournament,
    unverifiedAccount?.withdrawnTournaments,
    delivery,
  );
}

/**
 * The stage of `enterTournament()` that refuses the submission when a later
 * one has taken the unverified account over since (see
 * `isStillUnverifiedAccountOf()`).
 * @param db The Supabase client to read with.
 * @param participantId The account the entry was written for.
 * @param passwordHash The hash this submission set on it.
 */
async function ensureStillUnverifiedAccountOf(
  db: DbClient,
  participantId: string,
  passwordHash: string,
): Promise<{ok: true} | LibFailure<409>> {
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
 * The first stage of `enterTournament()`: cancels the participant's entries
 * whose verification link expired unused (`lapse_expired_pending_entries()`).
 * @param db The Supabase client to write with.
 * @param participantId The participant being entered.
 */
async function lapseExpiredPendingEntries(
  db: DbClient,
  participantId: string,
): Promise<{ok: true} | InternalFailure> {
  // An entry whose verification link expired unused can never be confirmed,
  // yet it would still refuse a re-entry in `findReusableEntry()` as
  // `already entered` and, in a region without dual entry, hold the region's
  // other tournament too (#172). Cancelling those first lets that check and
  // the seat trigger treat them like any cancellation: this tournament's row
  // is reused with a fresh link, and the other tournament's no longer counts.
  // Entries whose link is still valid are left alone. Done here rather than
  // by a scheduled sweep, since only a new entry from the same participant is
  // ever held up by one.
  const {error: lapseError} = await db.rpc('lapse_expired_pending_entries', {
    p_participant_id: participantId,
  });
  if (lapseError) {
    return {ok: false, status: 500, error: lapseError.message};
  }
  return {ok: true};
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
async function findReusableEntry(
  db: DbClient,
  participantId: string,
  tournamentId: string,
): Promise<
  {ok: true; existingEntry: ExistingEntryRow | null} | LibFailure<409>
> {
  // A participant who cancelled may enter the same tournament again with the
  // same credentials. The unique (participant_id, tournament_id) constraint
  // means that has to reuse the cancelled row instead of inserting a second
  // one.
  const {data: existingEntry, error: existingEntryError} = await db
    .from('entries')
    .select(EXISTING_ENTRY_COLUMNS)
    .eq('participant_id', participantId)
    .eq('tournament_id', tournamentId)
    .maybeSingle();
  if (existingEntryError) {
    return {ok: false, status: 500, error: existingEntryError.message};
  }
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
 * The stage of `enterTournament()` that moves a verified participant to the
 * tournament's region (`claim_participant_region_for_tournament()`),
 * refusing the submission when they are taking part in another region whose
 * tournament uses the same question set. Skipped for an unverified account
 * (see the call site).
 * @param db The Supabase client to write with.
 * @param participantId The participant being entered.
 * @param tournamentId The tournament being entered.
 */
async function claimTournamentRegion(
  db: DbClient,
  participantId: string,
  tournamentId: string,
): Promise<{ok: true} | LibFailure<409>> {
  const {data: claimedRegion, error: claimError} = await db.rpc(
    'claim_participant_region_for_tournament',
    {
      p_participant_id: participantId,
      p_tournament_id: tournamentId,
    },
  );
  if (claimError) {
    return {ok: false, status: 500, error: claimError.message};
  }
  if (!claimedRegion) {
    return {
      ok: false,
      status: 409,
      error: ENTRY_ERROR_CODES.ALREADY_REGISTERED_IN_ANOTHER_REGION,
    };
  }
  return {ok: true};
}

/**
 * The stage of `enterTournament()` that writes the `entries` row: a fresh
 * insert, or `reenter_cancelled_entry()` over the participant's own
 * cancelled row. This is the write the region's dual-entry rule refuses, by
 * trigger. Nothing is left behind when it fails, so there is nothing to roll
 * back.
 * @param db The Supabase client to write with.
 * @param participantId The participant being entered.
 * @param tournamentId The tournament being entered.
 * @param input The entry itself.
 * @param existingEntry The cancelled entry to reuse, from
 *     `findReusableEntry()`, or `null` to insert a fresh one.
 */
async function writeEntry(
  db: DbClient,
  participantId: string,
  tournamentId: string,
  input: EntrySessionInput,
  existingEntry: ExistingEntryRow | null,
): Promise<{ok: true; entryId: string} | LibFailure<409>> {
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
  // `regions.allows_dual_entry` lives: it decides under the participant's row
  // lock, so nothing checked ahead of the write could add to it, and a copy
  // here could only drift from it.
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
  // (0043): one a concurrent submission took after this one last looked, or
  // one no check ahead of the write could see. Either way the seat is really
  // there, and retrying won't change that, so it is answered as taking part
  // there rather than as a concurrent submission.
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
    return {
      ok: false,
      status: 500,
      error: error?.message ?? 'failed to create entry',
    };
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
async function storeEntryRegulations(
  db: DbClient,
  entryId: string,
  tournamentId: string,
  regulationIds: readonly string[],
): Promise<{ok: true} | LibFailure<409>> {
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
    return regulationsError.code === FOREIGN_KEY_VIOLATION_SQLSTATE
      ? {
          ok: false,
          status: 409,
          error: ENTRY_ERROR_CODES.REGULATION_NO_LONGER_AVAILABLE,
        }
      : {ok: false, status: 500, error: regulationsError.message};
  }
  return {ok: true};
}

/**
 * The last stage of `enterTournament()`: mails the verification link of the
 * entry just written.
 * @param env The Worker bindings.
 * @param entryId The entry `writeEntry()` wrote.
 * @param email The participant's address, where the link is sent.
 * @param tournament The checked tournament.
 * @param withdrawnTournaments The tournaments whose pending entries a
 *     takeover withdrew (see `withdrawnTournamentNames()`), if any.
 */
async function mailVerificationLink(
  env: Bindings,
  entryId: string,
  email: string,
  tournament: EntryTournamentRow,
  withdrawnTournaments: string[] | undefined,
  delivery: EntryMailDelivery,
): Promise<{ok: true} | InternalFailure> {
  try {
    if (delivery === 'deferred') {
      // Written now, mailed later (`lib/deferred-entry-mail.ts`). A failure
      // to hold or enqueue it is a mail that will never go out, so it rolls
      // the entry back like a failed send.
      await holdForDeferredVerification(env, entryId);
      await deferEntryMail(env, {
        kind: 'deferred-verification',
        entryId,
        to: email,
        ...(withdrawnTournaments ? {withdrawnTournaments} : {}),
      });
      return {ok: true};
    }
    await sendVerificationEmail(
      env,
      entryId,
      email,
      tournamentDisplayName(
        tournament.name,
        tournament.regions.name,
        tournament.type,
      ),
      tournament.capacity !== null,
      withdrawnTournaments,
    );
  } catch (mailError) {
    // Failing here is what gets the entry rolled back: the participant never
    // received a usable verification link, so the entry they can't confirm
    // must not stand in the way of them trying again.
    const message =
      mailError instanceof Error ? mailError.message : 'unknown error';
    return {
      ok: false,
      status: 500,
      error: `failed to send verification email: ${message}`,
    };
  }
  return {ok: true};
}

/**
 * Whether the unverified account an entry was just written for still has
 * the password this submission gave it.
 *
 * Every link mailed for an unverified account has to belong to a
 * submission made with the account's current password and region, because
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

/**
 * The refusals `createEntryAfterCheck()` can end in that are about the
 * address's own account, mapped to the mail that tells its owner. Each is
 * something only the owner of the address should learn, so the
 * unauthenticated route mails it instead of answering with it.
 */
const ENTRY_NOTICE_REASONS: Partial<Record<EntryErrorCode, EntryNoticeReason>> =
  {
    [ENTRY_ERROR_CODES.INVALID_PASSWORD]: 'password-mismatch',
    [ENTRY_ERROR_CODES.ALREADY_REGISTERED_IN_ANOTHER_REGION]: 'other-region',
    [ENTRY_ERROR_CODES.ALREADY_ENTERED]: 'already-entered',
    [ENTRY_ERROR_CODES.ENTRY_PENDING_VERIFICATION]: 'pending-verification',
    [ENTRY_ERROR_CODES.COMMON_PASSWORD]: 'common-password',
    [ENTRY_ERROR_CODES.ALREADY_ENTERED_ANOTHER_TOURNAMENT]: 'dual-entry',
    [ENTRY_ERROR_CODES.REGULATION_NO_LONGER_AVAILABLE]:
      'regulation-unavailable',
  };

/**
 * When the mail of an anonymous entry goes out: at once, or later from the
 * queue because its address was over the per-address limit when it was
 * submitted (#346, `lib/deferred-entry-mail.ts`). The entry itself is made
 * the same way either way.
 */
export type EntryMailDelivery = 'now' | 'deferred';

/**
 * Enters an address-and-password submission whose answer the client never
 * sees (#117). The route has already answered -- identically, whatever the
 * address -- and runs this in `waitUntil()`, so the time it takes is not
 * visible either.
 *
 * - An unregistered address gets an account and the entry, as before.
 * - A registered address that was never verified has its account taken
 *   over -- password and region replaced, earlier submissions' entries
 *   dropped -- and gets the entry (#189). With the account's own password
 *   it is entered under the same rules as a verified one, in any region.
 * - A verified address with the matching password gets the entry.
 * - Anything about the address's own account that would otherwise have
 *   been an error -- a wrong password, taking part in another region, an
 *   entry already made -- is mailed to that address instead, so only its
 *   owner learns it. No entry is made.
 * - A failure on our side is logged; there is no one left to tell.
 * @param env The Worker bindings.
 * @param tournament The tournament, already through
 *     `checkEntrySubmission()`.
 * @param input The validated entry form submission.
 */
export async function createEntryUnauthenticated(
  env: Bindings,
  tournament: EntryTournamentRow,
  input: EntryInput,
  delivery: EntryMailDelivery = 'now',
): Promise<CreateEntryOutcome> {
  // Runs after the response, inside `waitUntil()`, where a throw would
  // surface as an unhandled rejection with none of the context below. So a
  // thrown error (a network failure inside the Supabase client, say) is
  // treated like any other failure on our side.
  let result: CreateEntryResult;
  try {
    result = await createEntryAfterCheck(env, tournament, input, delivery);
  } catch (e) {
    result = {
      ok: false,
      status: 500,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  if (result.ok) {
    return {kind: 'created', entryId: result.entry.id};
  }

  // Only a known code: `error` can be any thrown or database message, and one
  // spelling an inherited property would otherwise read as a reason.
  const reason = isEntryErrorCode(result.error)
    ? ENTRY_NOTICE_REASONS[result.error]
    : undefined;
  if (!reason) {
    // The address itself isn't logged: it is what an attacker would be
    // probing for, and nothing here needs it to be diagnosed.
    console.error('failed to create an unauthenticated entry', {
      tournamentId: tournament.id,
      status: result.status,
      error: result.error,
    });
    // The submitter was told a mail was on its way, so one is sent even
    // now, asking them to try again -- unless the mail provider is what
    // failed, in which case this one fails too and the log above is all
    // there is.
    await sendEntryNotice(
      env,
      input.email,
      tournament,
      'processing-failed',
      delivery,
    );
    return {kind: 'failed', error: result.error};
  }
  if (
    !(await sendEntryNotice(env, input.email, tournament, reason, delivery))
  ) {
    return {kind: 'failed', error: 'failed to send the entry notice'};
  }
  return {kind: 'notified', reason};
}

/**
 * Sends an entry notice, logging rather than throwing a failure: it runs in
 * the background, with no one left to report to.
 * @return Whether the notice went out.
 */
async function sendEntryNotice(
  env: Bindings,
  email: string,
  tournament: EntryTournamentRow,
  reason: EntryNoticeReason,
  delivery: EntryMailDelivery,
): Promise<boolean> {
  const tournamentName = tournamentDisplayName(
    tournament.name,
    tournament.regions.name,
    tournament.type,
  );
  try {
    if (delivery === 'deferred') {
      await deferEntryMail(env, {
        kind: 'deferred-notice',
        to: email,
        tournamentName,
        reason,
      });
    } else {
      await sendEntryNoticeEmail(env, email, tournamentName, reason);
    }
    return true;
  } catch (mailError) {
    console.error('failed to send the entry notice', {
      tournamentId: tournament.id,
      reason,
      error: mailError,
    });
    return false;
  }
}

/**
 * Enters a logged-in participant (`POST /tournaments/:tournamentId/entries/
 * session`). The session has already proved who they are, so there is no
 * password to check, and every refusal is reported directly: nothing it
 * says is news to the person it is said to.
 * @param env The Worker bindings.
 * @param tournamentId The tournament being entered.
 * @param participantId The logged-in participant, from the session cookie.
 * @param input The validated entry form submission, without credentials.
 */
export async function createEntryForParticipant(
  env: Bindings,
  tournamentId: string,
  participantId: string,
  input: EntrySessionInput,
): Promise<CreateEntryResult> {
  const check = await checkEntrySubmission(env, tournamentId, input);
  if (!check.ok) {
    return check;
  }
  const {tournament} = check;

  const db = createDbClient(env);
  const {data: participant, error} = await db
    .from('participants')
    .select('email')
    .eq('id', participantId)
    .maybeSingle();
  if (error) {
    return {ok: false, status: 500, error: error.message};
  }
  if (!participant) {
    // `requireParticipant()` read this same row a moment ago, so it was
    // deleted in between; the session no longer names anyone.
    return {ok: false, status: 401, error: COMMON_ERROR_CODES.UNAUTHORIZED};
  }
  return enterTournament(
    env,
    tournament,
    participantId,
    participant.email,
    input,
  );
}
