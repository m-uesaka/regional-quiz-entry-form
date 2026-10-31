import {
  EDITABLE_ENTRY_STATUSES,
  findCustomFieldValuesError,
  isRegulationSelectionAllowed,
  isWithinEntryPeriod,
  type EntryEditInput,
  type EntryInput,
  type EntrySessionInput,
  type EntryStatus,
  type TournamentType,
} from '@regional-quiz/shared';
import {isCommonPassword} from '@regional-quiz/shared/password-policy';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {sendEntryNoticeEmail, type EntryNoticeReason} from './entry-notice';
import {sendVerificationEmail} from './entry-verification';
import {FORM_FIELD_DEF_COLUMNS, toFormFieldDef} from './form-field-defs';
import type {FormFieldDefRow} from './form-field-defs';
import {hashPassword, verifyPassword} from './password';
import {tournamentDisplayName} from './tournaments';
import {verifyAccountPassword} from './password-rehash';
import {promoteWaitlistedEntries} from './waitlist';

type CreateEntryResult =
  | {ok: true; entry: {id: string}}
  | {ok: false; status: 400 | 401 | 403 | 409 | 500; error: string};

/**
 * What the address-independent half of an entry submission concluded: the
 * tournament it can go on to enter, or why it can't.
 */
export type EntrySubmissionCheck =
  | {ok: true; tournament: EntryTournamentRow}
  | {ok: false; status: 400 | 403 | 500; error: string};

/**
 * What an unauthenticated entry submission came to, once it has run in the
 * background (`createEntryUnauthenticated()`). Never sent to the client,
 * whose answer is the same whichever of these it was.
 */
export type CreateEntryOutcome =
  | {kind: 'created'; entryId: string}
  | {kind: 'notified'; reason: EntryNoticeReason}
  | {kind: 'failed'; error: string};

type UpdateOwnEntryResult =
  {ok: true} | {ok: false; status: 400 | 403 | 404 | 500; error: string};

type CancelOwnEntryResult =
  {ok: true} | {ok: false; status: 404 | 500; error: string};

interface RegulationRow {
  id: string;
  priority_starts_at: string | null;
  priority_ends_at: string | null;
}

/** The tournament an entry submission is checked against. */
export interface EntryTournamentRow {
  id: string;
  name: string | null;
  type: TournamentType;
  region_id: string;
  // Null for an uncapped tournament, which can never waitlist anyone.
  capacity: number | null;
  entry_opens_at: string;
  entry_closes_at: string;
  entries_paused: boolean;
  // A to-one embed, so PostgREST answers with the region object itself
  // rather than a single-element array (unlike `regulations` below).
  regions: {allows_dual_entry: boolean; name: string};
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
 * The errors about the address's own account, named once: besides being
 * answered by the logged-in route, each is what `ENTRY_NOTICE_REASONS` maps
 * to the mail the unauthenticated route sends instead, so a string spelled
 * one way here and another way there would silently stop that mail.
 */
const INVALID_PASSWORD = 'invalid password';
const ALREADY_REGISTERED_IN_ANOTHER_REGION =
  'already registered in another region';
const ALREADY_ENTERED = 'already entered';
/**
 * An entry for the tournament is waiting on a verification link that is
 * still valid. Told apart from `ALREADY_ENTERED` so the participant is sent
 * to that mail rather than to an entry that isn't confirmed yet (#172).
 */
const ENTRY_PENDING_VERIFICATION = 'entry pending verification';
const COMMON_PASSWORD = 'password too common';
/**
 * A later submission under the same unverified address took the account
 * over while this one was being entered (`isStillUnverifiedAccountOf()`).
 * Not one of the notice reasons: the later submission sends its own mail,
 * and this one is answered like any other failure on our side.
 */
const SUPERSEDED_BY_LATER_SUBMISSION = 'superseded by a later submission';
/**
 * Another submission for the same address -- or the same participant and
 * tournament -- wrote its row first, and the database refused this one's.
 * Spelled out instead of passing the refusal on: Postgres' message names the
 * table and the constraint, and the logged-in route answers 4xx messages as
 * they are (#191). Like `SUPERSEDED_BY_LATER_SUBMISSION`, not a notice
 * reason: the anonymous route answers it like any other failure on our side,
 * logging it and mailing `processing-failed` alongside the winner's own mail.
 */
const CONCURRENT_SUBMISSION = 'concurrent submission';

/**
 * The SQLSTATE `check_region_dual_entry()` (migration 0016) raises. The
 * trigger only fires for a submission that slipped through the check below
 * while a concurrent one was being inserted, so it is a race, not a bug in
 * the caller — but the participant caused it and 409 is still the honest
 * answer.
 */
const REGION_DUAL_ENTRY_SQLSTATE = 'P0005';

/**
 * Postgres' own `foreign_key_violation`, which is what a regulation dropped
 * by a concurrent `sync_regulations()` makes the `entry_regulations` write
 * raise. It is the only failure of that write the participant can act on,
 * so it alone earns `REGULATION_NO_LONGER_AVAILABLE`; anything else (a
 * network blip, Supabase being down) is a server fault, and telling the
 * participant their regulations changed would send them to reload a page
 * that will fail again in exactly the same way.
 */
const FOREIGN_KEY_VIOLATION_SQLSTATE = '23503';

/**
 * Postgres' own `unique_violation`: a concurrent submission inserted the
 * same participant (`participants.email`) or the same entry
 * (`entries (participant_id, tournament_id)`) first.
 */
const UNIQUE_VIOLATION_SQLSTATE = '23505';

/**
 * PostgREST's code for a `.single()` that matched no row. On the re-entry
 * update it means a concurrent re-entry already took the cancelled row.
 */
const NO_ROW_PGRST_CODE = 'PGRST116';

interface ParticipantRow {
  id: string;
  region_id: string;
  password_hash: string;
  // Null until the owner of the address follows a verification link
  // (migration 0034, #189).
  email_verified_at: string | null;
}

/** What `ParticipantRow` is selected with. */
const PARTICIPANT_COLUMNS = 'id, region_id, password_hash, email_verified_at';

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
 * "wrong password" or "registered in another region" to whoever submitted
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
      'id, name, type, region_id, capacity, entry_opens_at, entry_closes_at, ' +
        'entries_paused, ' +
        'regions(allows_dual_entry, name), ' +
        'regulations(id, priority_starts_at, priority_ends_at)',
    )
    .eq('id', tournamentId)
    .returns<EntryTournamentRow[]>()
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
  // Paused by staff (0039). Only new entries stop: edits, cancellations and
  // confirmations of entries already made go on.
  if (tournament.entries_paused) {
    return {ok: false, status: 403, error: 'entries paused'};
  }

  const regulations = tournament.regulations.map(regulation => ({
    id: regulation.id,
    priorityStartsAt: regulation.priority_starts_at,
    priorityEndsAt: regulation.priority_ends_at,
  }));
  if (
    !isRegulationSelectionAllowed(
      regulations,
      submission.regulationIds,
      now,
      tournament.entry_closes_at,
    )
  ) {
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
    submission.customFieldValues,
  );
  if (customFieldValuesError) {
    return {ok: false, status: 400, error: customFieldValuesError.message};
  }
  return {ok: true, tournament};
}

/**
 * The address-dependent half of `createEntry()`, for a submission that
 * already passed `checkEntrySubmission()`: finds or creates the participant
 * the address belongs to and enters them.
 *
 * A participant whose address has been verified must prove ownership by
 * password, and stays in the region it registered in. One whose address
 * never was (#189) is taken over instead: the account was made by a
 * submission nobody has confirmed, possibly from someone who typed another
 * person's address to lock them into a far region, so its password and
 * region carry no weight. The submission at hand replaces them, the same
 * way it would have created the account had it come first -- unless it
 * comes with the account's own password for the account's own region, which
 * makes it a further entry from whoever made the account.
 * @param env The Worker bindings.
 * @param tournament The checked tournament.
 * @param input The validated entry form submission.
 */
async function createEntryAfterCheck(
  env: Bindings,
  tournament: EntryTournamentRow,
  input: EntryInput,
): Promise<CreateEntryResult> {
  const db = createDbClient(env);

  const {data: existingParticipant, error: participantError} = await db
    .from('participants')
    .select(PARTICIPANT_COLUMNS)
    .eq('email', input.email)
    .returns<ParticipantRow[]>()
    .maybeSingle();
  if (participantError) {
    return {ok: false, status: 500, error: participantError.message};
  }

  if (
    existingParticipant?.email_verified_at === null &&
    existingParticipant.region_id === tournament.region_id &&
    (await isUnverifiedAccountPassword(existingParticipant, input.password))
  ) {
    // Whoever made the account is still the one submitting, for the same
    // region: nothing to take over, and the entries they made earlier stand
    // -- a participant entering both of a region's tournaments before
    // following either link keeps both (or is refused the second, where the
    // region allows only one). Every link of the account still belongs to a
    // submission made with its current password and region.
    return enterTournament(
      env,
      tournament,
      existingParticipant.id,
      input.email,
      input,
      {passwordHash: existingParticipant.password_hash},
    );
  }

  if (!existingParticipant || existingParticipant.email_verified_at === null) {
    // Whoever this account is about to belong to is setting its password,
    // so they are held to the rules for setting one. The form's own schema
    // can't apply them (the same field is how a returning participant proves
    // an older password), and doing it here keeps the refusal behind the
    // address like every other answer that depends on it.
    if (isCommonPassword(input.password)) {
      return {ok: false, status: 400, error: COMMON_PASSWORD};
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
      if (error?.code === UNIQUE_VIOLATION_SQLSTATE) {
        return {ok: false, status: 409, error: CONCURRENT_SUBMISSION};
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
      return enterTournament(env, tournament, created.id, input.email, input, {
        passwordHash,
      });
    }
    // A different password, or another region: the account is handed to
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
    if (Array.isArray(withdrawn)) {
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
            (withdrawn as string[]).filter(id => id !== tournament.id),
          ),
        },
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
      .returns<ParticipantRow[]>()
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
    );
  }

  return enterVerifiedParticipant(env, tournament, existingParticipant, input);
}

/**
 * Enters a submission into a participant whose address has been verified,
 * once it proves the account's password, for the account's own region.
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
): Promise<CreateEntryResult> {
  if (participant.region_id !== tournament.region_id) {
    return {
      ok: false,
      status: 409,
      error: ALREADY_REGISTERED_IN_ANOTHER_REGION,
    };
  }

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
    return {ok: false, status: 401, error: INVALID_PASSWORD};
  }
  await upgrade;
  return enterTournament(env, tournament, participant.id, input.email, input);
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
  db: ReturnType<typeof createDbClient>,
  tournamentIds: string[],
): Promise<string[] | undefined> {
  if (tournamentIds.length === 0) {
    return undefined;
  }
  const {data, error} = await db
    .from('tournaments')
    .select('name, type, regions(name)')
    .in('id', tournamentIds)
    .returns<
      Array<{
        name: string | null;
        type: TournamentType;
        regions: {name: string};
      }>
    >();
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
 * enforces the region's dual-entry rule, writes the entry and its
 * regulations and mails the verification link.
 * @param env The Worker bindings.
 * @param tournament The checked tournament.
 * @param participantId The participant being entered.
 * @param email The participant's address, where the link is sent.
 * @param input The entry itself.
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
): Promise<CreateEntryResult> {
  const db = createDbClient(env);
  const tournamentId = tournament.id;

  // An entry whose verification link expired unused can never be confirmed,
  // yet it would still refuse a re-entry below as `already entered` and, in
  // a region without dual entry, hold the region's other tournament too
  // (#172). Cancelling those first lets both checks below treat them like
  // any cancellation: this tournament's row is reused with a fresh link, and
  // the other tournament's no longer counts. Entries whose link is still
  // valid are left alone. Done here rather than by a scheduled sweep, since
  // only a new entry from the same participant is ever held up by one.
  const {error: lapseError} = await db.rpc('lapse_expired_pending_entries', {
    p_participant_id: participantId,
  });
  if (lapseError) {
    return {ok: false, status: 500, error: lapseError.message};
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
    return {
      ok: false,
      status: 409,
      // Still pending after the lapse above means its link is still valid.
      error:
        existingEntry.status === 'pending_verification'
          ? ENTRY_PENDING_VERIFICATION
          : ALREADY_ENTERED,
    };
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
      // tournaments by simply never following the link. One whose link
      // expired was cancelled above, so only a still-valid link holds it.
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

  if (existingEntry) {
    // The cancelled row still carries the tokens of the entry it was
    // cancelled from, all burnt or expired (`cancel_own_entry()` and
    // `lapse_expired_pending_entries()` burn what was left). Dropped before the row goes back
    // to `pending_verification`, so that until its new link is written it
    // has no tokens at all -- which is what tells
    // `lapse_expired_pending_entries()` in a concurrent submission of the
    // same participant's that this entry is being made, not one whose link
    // ran out. Only dead tokens go: a concurrent re-entry of this same row
    // may already have written a live one, which must survive.
    const {error: tokensError} = await db
      .from('email_verification_tokens')
      .delete()
      .eq('entry_id', existingEntry.id)
      .or(`used_at.not.is.null,expires_at.lt.${new Date().toISOString()}`);
    if (tokensError) {
      return {ok: false, status: 500, error: tokensError.message};
    }
  }

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
  if (
    error?.code === UNIQUE_VIOLATION_SQLSTATE ||
    (existingEntry && error?.code === NO_ROW_PGRST_CODE)
  ) {
    return {ok: false, status: 409, error: CONCURRENT_SUBMISSION};
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
      code: regulationsError.code,
      error: regulationsError.message,
    });
    await rollbackEntry(db, entry.id, tournamentId, existingEntry);
    return regulationsError.code === FOREIGN_KEY_VIOLATION_SQLSTATE
      ? {ok: false, status: 409, error: REGULATION_NO_LONGER_AVAILABLE}
      : {ok: false, status: 500, error: regulationsError.message};
  }

  if (
    unverifiedAccount &&
    !(await isStillUnverifiedAccountOf(
      db,
      participantId,
      unverifiedAccount.passwordHash,
    ))
  ) {
    await rollbackEntry(db, entry.id, tournamentId, existingEntry);
    return {ok: false, status: 409, error: SUPERSEDED_BY_LATER_SUBMISSION};
  }

  try {
    await sendVerificationEmail(
      env,
      entry.id,
      email,
      tournamentDisplayName(
        tournament.name,
        tournament.regions.name,
        tournament.type,
      ),
      tournament.capacity !== null,
      unverifiedAccount?.withdrawnTournaments,
    );
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
  db: ReturnType<typeof createDbClient>,
  participantId: string,
  passwordHash: string,
): Promise<boolean> {
  const {data} = await db
    .from('participants')
    .select('password_hash')
    .eq('id', participantId)
    .returns<Array<{password_hash: string}>>()
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
const ENTRY_NOTICE_REASONS: Record<string, EntryNoticeReason> = {
  [INVALID_PASSWORD]: 'password-mismatch',
  [ALREADY_REGISTERED_IN_ANOTHER_REGION]: 'other-region',
  [ALREADY_ENTERED]: 'already-entered',
  [ENTRY_PENDING_VERIFICATION]: 'pending-verification',
  [COMMON_PASSWORD]: 'common-password',
  [ALREADY_ENTERED_ANOTHER_TOURNAMENT]: 'dual-entry',
  [REGULATION_NO_LONGER_AVAILABLE]: 'regulation-unavailable',
};

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
 *   and region it is simply entered, like a verified one.
 * - A verified address with the matching password gets the entry.
 * - Anything about the address's own account that would otherwise have
 *   been an error -- a wrong password, registration in another region, an
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
): Promise<CreateEntryOutcome> {
  // Runs after the response, inside `waitUntil()`, where a throw would
  // surface as an unhandled rejection with none of the context below. So a
  // thrown error (a network failure inside the Supabase client, say) is
  // treated like any other failure on our side.
  let result: CreateEntryResult;
  try {
    result = await createEntryAfterCheck(env, tournament, input);
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

  const reason = ENTRY_NOTICE_REASONS[result.error];
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
    await sendEntryNotice(env, input.email, tournament, 'processing-failed');
    return {kind: 'failed', error: result.error};
  }
  if (!(await sendEntryNotice(env, input.email, tournament, reason))) {
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
): Promise<boolean> {
  try {
    await sendEntryNoticeEmail(
      env,
      email,
      tournamentDisplayName(
        tournament.name,
        tournament.regions.name,
        tournament.type,
      ),
      reason,
    );
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

/** Shape of the participant lookup in `createEntryForParticipant()`. */
interface SessionParticipantRow {
  email: string;
  region_id: string;
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
    .select('email, region_id')
    .eq('id', participantId)
    .returns<SessionParticipantRow[]>()
    .maybeSingle();
  if (error) {
    return {ok: false, status: 500, error: error.message};
  }
  if (!participant) {
    // `requireParticipant()` read this same row a moment ago, so it was
    // deleted in between; the session no longer names anyone.
    return {ok: false, status: 401, error: 'unauthorized'};
  }
  if (participant.region_id !== tournament.region_id) {
    return {
      ok: false,
      status: 409,
      error: ALREADY_REGISTERED_IN_ANOTHER_REGION,
    };
  }
  return enterTournament(
    env,
    tournament,
    participantId,
    participant.email,
    input,
  );
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
      // this runs. `promote_waitlisted_entries` therefore counts the free
      // seats under its own tournament lock and promotes nobody when the
      // seat has been taken, instead of pushing the tournament over
      // capacity. A mail it couldn't send is logged there.
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
