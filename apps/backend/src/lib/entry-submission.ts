/**
 * @fileoverview Entry submissions: checking one against its tournament
 * (`checkEntrySubmission()`), settling whose it is, and entering them
 * (`enterTournament()`), rolling the entry back when a later step fails. The
 * stages around that live next to it: `entry-write.ts` (the write and its
 * rollback), `entry-takeover.ts` (unverified accounts), and
 * `entry-unauthenticated.ts` (the unauthenticated route's notices, which
 * imports `createEntryAfterCheck()` from here); the types they share are in
 * `entry-submission-types.ts`. Editing or cancelling an entry once made is
 * `own-entries.ts`.
 */

import {
  COMMON_ERROR_CODES,
  ENTRY_ERROR_CODES,
  entryAvailability,
  regulationSelectionRefusal,
  type EntryErrorCode,
  type EntryInput,
  type EntrySessionInput,
  type RegulationSelectionRefusal,
} from '@regional-quiz/shared';
import {isCommonPassword} from '@regional-quiz/shared/password-policy';
import type {Bindings} from '../types/env';
import {type DbClient, type Tables} from './db';
import {
  holdForDeferredVerification,
  sendVerificationEmail,
} from './entry-verification';
import {deferEntryMail} from './deferred-entry-mail';
import {
  FailureAfterTakeover,
  type AddressEntryResult,
  type CreateEntryResult,
  type EntryMailDelivery,
  type EntryTournamentRow,
} from './entry-submission-types';
import {
  ensureStillUnverifiedAccountOf,
  withdrawnTournamentNames,
  withdrawnWithoutReplacement,
} from './entry-takeover';
import {
  findReusableEntry,
  rollbackEntry,
  storeEntryRegulations,
  writeEntry,
} from './entry-write';
import {UnexpectedFailure, unwrap, type ClientFailure} from './errors';
import {validateCustomFieldValues} from './form-field-defs';
import {hashPassword, verifyPassword} from './password';
import {UNIQUE_VIOLATION_SQLSTATE} from './pg-errors';
import {tournamentDisplayName} from './tournaments';
import {verifyAccountPassword} from './password-rehash';

/**
 * What the address-independent half of an entry submission concluded: the
 * tournament it can go on to enter, or why it can't.
 */
export type EntrySubmissionCheck =
  {ok: true; tournament: EntryTournamentRow} | ClientFailure<400 | 403 | 409>;

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
  'id' | 'password_hash' | 'email_verified_at'
>;

/** What `ParticipantRow` is selected with. */
const PARTICIPANT_COLUMNS = 'id, password_hash, email_verified_at';

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
  db: DbClient,
  tournamentId: string,
  input: EntryInput,
): Promise<CreateEntryResult> {
  const check = await checkEntrySubmission(db, tournamentId, input);
  if (!check.ok) {
    return check;
  }
  return createEntryAfterCheck(env, db, check.tournament, input);
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
  db: DbClient,
  tournamentId: string,
  submission: Pick<EntrySessionInput, 'regulationIds' | 'customFieldValues'>,
): Promise<EntrySubmissionCheck> {
  // A failing select is not the same as an unknown tournament: a stale
  // PostgREST schema cache or an outage would otherwise turn every submission
  // into 「大会が見つかりません」 with nothing logged. Kept apart so the 500
  // says so (`unwrap()` throws it).
  const tournament = unwrap(
    await db
      .from('tournaments')
      .select(
        `
        id, name, type, capacity, entry_opens_at, entry_closes_at,
        entries_paused,
        regions(name),
        regulations(id, priority_starts_at, priority_ends_at,
        closes_with_priority)
      `,
      )
      .eq('id', tournamentId)
      .maybeSingle(),
    'failed to read the tournament to enter',
  );
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
 * someone who typed another person's address, so its password and entries
 * carry no weight. The submission at hand replaces them, the same way it
 * would have created the account had it come first -- unless it comes with
 * the account's own password, which makes it a further entry from whoever
 * made the account, held to the same rules as a verified one.
 * @param env The Worker bindings.
 * @param tournament The checked tournament.
 * @param input The validated entry form submission.
 */
export async function createEntryAfterCheck(
  env: Bindings,
  db: DbClient,
  tournament: EntryTournamentRow,
  input: EntryInput,
  delivery: EntryMailDelivery = 'now',
): Promise<AddressEntryResult> {
  const existingParticipant = unwrap(
    await db
      .from('participants')
      .select(PARTICIPANT_COLUMNS)
      .eq('email', input.email)
      .maybeSingle(),
    'failed to read the participant to enter',
  );

  if (
    existingParticipant?.email_verified_at === null &&
    (await isUnverifiedAccountPassword(existingParticipant, input.password))
  ) {
    // Whoever made the account is still the one submitting, so there is
    // nothing to take over, and the entries they made earlier stand -- a
    // participant entering both of a region's tournaments, or tournaments of
    // two regions using different question sets, before following any link
    // keeps them all. Every link of the account still belongs to a submission
    // made with its current password.
    //
    // A tournament the account's entries rule out -- another region's on the
    // same question set -- is refused by `check_entry_seat()` at the write,
    // as it would be for a verified account, rather than taken over: a
    // takeover would delete the account's other entries too, including those
    // this tournament doesn't conflict with.
    return enterTournament(
      env,
      db,
      tournament,
      existingParticipant.id,
      input.email,
      input,
      {passwordHash: existingParticipant.password_hash},
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
        throw new UnexpectedFailure(
          'failed to create the participant',
          error ?? {message: 'the insert returned no row'},
        );
      }
      return enterTournament(
        env,
        db,
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
    const withdrawn = unwrap(
      await db.rpc('take_over_unverified_participant', {
        p_participant_id: existingParticipant.id,
        p_password_hash: passwordHash,
      }),
      'failed to take the unverified participant over',
    );
    // Null when the address turned out to be verified (see below).
    if (withdrawn !== null) {
      const otherWithdrawn = await withdrawnTournamentNames(
        db,
        withdrawn.filter(id => id !== tournament.id),
      );
      // Only the new entry is rolled back on a failure; what the takeover
      // deleted stays deleted, this tournament's earlier entry included. So
      // a failure, returned or thrown, carries what it withdrew.
      const withdrawnTournaments = withdrawnWithoutReplacement(
        tournament,
        withdrawn,
        otherWithdrawn,
      );
      let entered;
      try {
        entered = await enterTournament(
          env,
          db,
          tournament,
          existingParticipant.id,
          input.email,
          input,
          {passwordHash, withdrawnTournaments: otherWithdrawn},
          delivery,
        );
      } catch (e) {
        throw e instanceof UnexpectedFailure
          ? new FailureAfterTakeover(e, withdrawnTournaments)
          : e;
      }
      if (entered.ok) {
        return entered;
      }
      return withdrawnTournaments
        ? {...entered, withdrawnTournaments}
        : entered;
    }
    // The address was verified since it was read above -- its owner
    // followed a link a moment ago -- so the account is theirs now, and
    // this submission is held to it like any other. Read again, because
    // what the takeover found verified need not be the row read above:
    // another submission may have taken the account over in between, and
    // had its own link followed, leaving another password.
    const {data: verifiedParticipant, error: rereadError} = await db
      .from('participants')
      .select(PARTICIPANT_COLUMNS)
      .eq('id', existingParticipant.id)
      .single();
    if (rereadError || !verifiedParticipant) {
      throw new UnexpectedFailure(
        'failed to read the participant',
        rereadError ?? {message: 'the participant is gone'},
      );
    }
    return enterVerifiedParticipant(
      env,
      db,
      tournament,
      verifiedParticipant,
      input,
      delivery,
    );
  }

  return enterVerifiedParticipant(
    env,
    db,
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
  db: DbClient,
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
    db,
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
    db,
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
 * Enters a participant whose identity is already settled -- by password in
 * `createEntryAfterCheck()`, or by session in `createEntryForParticipant()`
 * -- into a checked tournament: lapses their entries whose verification
 * link expired unused, reuses their own cancelled entry if there is one,
 * writes the entry -- which is what the region's dual-entry rule and the
 * rule against two regions on one question set refuse, by trigger -- and
 * its regulations and mails the verification link.
 *
 * Each of those steps is a stage function below, run in that order, and the
 * first one to refuse ends the submission. A stage only reports its
 * failure, by returning a refusal or by throwing: when one after the write
 * fails either way, this function rolls the entry back (`rollbackEntry()`),
 * once, for all of them.
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
  db: DbClient,
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
  const tournamentId = tournament.id;

  await lapseExpiredPendingEntries(db, participantId);

  const reusable = await findReusableEntry(db, participantId, tournamentId);
  if (!reusable.ok) {
    return reusable;
  }
  const {existingEntry} = reusable;

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

  // Rolled back here, and only here, for every stage after the write: a
  // refused submission must not leave behind an entry that would block its
  // own retry (see `rollbackEntry()`). A stage that fails unexpectedly throws
  // instead of refusing (#378), so that is caught too: the entry is rolled
  // back all the same, and the failure goes on to `app.onError`.
  let completed;
  try {
    completed = await completeWrittenEntry(
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
  } catch (e) {
    await rollbackEntry(db, entryId, tournamentId, existingEntry);
    throw e;
  }
  if (!completed.ok) {
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
): Promise<{ok: true} | ClientFailure<409>> {
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

  await mailVerificationLink(
    env,
    db,
    entryId,
    email,
    tournament,
    unverifiedAccount?.withdrawnTournaments,
    delivery,
  );
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
): Promise<void> {
  // An entry whose verification link expired unused can never be confirmed,
  // yet it would still refuse a re-entry in `findReusableEntry()` as
  // `already entered` and, in a region without dual entry, hold the region's
  // other tournament too (#172). Cancelling those first lets that check and
  // the seat trigger treat them like any cancellation: this tournament's row
  // is reused with a fresh link, and the other tournament's no longer counts.
  // Entries whose link is still valid are left alone. Done here rather than
  // by a scheduled sweep, since only a new entry from the same participant is
  // ever held up by one.
  unwrap(
    await db.rpc('lapse_expired_pending_entries', {
      p_participant_id: participantId,
    }),
    'failed to lapse the expired pending entries',
  );
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
  db: DbClient,
  entryId: string,
  email: string,
  tournament: EntryTournamentRow,
  withdrawnTournaments: string[] | undefined,
  delivery: EntryMailDelivery,
): Promise<void> {
  try {
    if (delivery === 'deferred') {
      // Written now, mailed later (`lib/deferred-entry-mail.ts`). A failure
      // to hold or enqueue it is a mail that will never go out, so it rolls
      // the entry back like a failed send.
      await holdForDeferredVerification(db, entryId);
      await deferEntryMail(env, {
        kind: 'deferred-verification',
        entryId,
        to: email,
        ...(withdrawnTournaments ? {withdrawnTournaments} : {}),
      });
      return;
    }
    await sendVerificationEmail(
      env,
      db,
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
    // Failing here is what gets the entry rolled back (by `enterTournament()`,
    // which catches this): the participant never received a usable
    // verification link, so the entry they can't confirm must not stand in the
    // way of them trying again.
    throw new UnexpectedFailure(
      'failed to send the verification email',
      mailError,
    );
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
  db: DbClient,
  tournamentId: string,
  participantId: string,
  input: EntrySessionInput,
): Promise<CreateEntryResult> {
  const check = await checkEntrySubmission(db, tournamentId, input);
  if (!check.ok) {
    return check;
  }
  const {tournament} = check;

  const participant = unwrap(
    await db
      .from('participants')
      .select('email')
      .eq('id', participantId)
      .maybeSingle(),
    'failed to read the participant to enter',
  );
  if (!participant) {
    // `requireParticipant()` read this same row a moment ago, so it was
    // deleted in between; the session no longer names anyone.
    return {ok: false, status: 401, error: COMMON_ERROR_CODES.UNAUTHORIZED};
  }
  return enterTournament(
    env,
    db,
    tournament,
    participantId,
    participant.email,
    input,
  );
}
