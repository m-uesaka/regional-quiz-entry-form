/**
 * @fileoverview The unauthenticated route's entry submission
 * (`createEntryUnauthenticated()`): runs the address-dependent half in the
 * background and turns a refusal into the notice mailed to the address
 * instead of an answer the client sees (#117).
 */

import {
  ENTRY_ERROR_CODES,
  isEntryErrorCode,
  type EntryErrorCode,
  type EntryInput,
} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import type {DbClient} from './db';
import {deferEntryMail} from './deferred-entry-mail';
import {sendEntryNoticeEmail, type EntryNoticeReason} from './entry-notice';
import {createEntryAfterCheck} from './entry-submission';
import {
  FailureAfterTakeover,
  type AddressEntryResult,
  type EntryMailDelivery,
  type EntryTournamentRow,
} from './entry-submission-types';
import {tournamentDisplayName} from './tournaments';

/**
 * A fault on our side as `createEntryUnauthenticated()` sees it, once caught:
 * not a refusal, so not a `ClientFailure`.
 */
interface UnexpectedEntryResult {
  ok: false;
  status: 500;
  error: string;
  withdrawnTournaments?: string[];
}

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
 * Enters an address-and-password submission whose answer the client never
 * sees (#117). The route has already answered -- identically, whatever the
 * address -- and runs this in `waitUntil()`, so the time it takes is not
 * visible either.
 *
 * - An unregistered address gets an account and the entry, as before.
 * - A registered address that was never verified has its account taken
 *   over -- password replaced, earlier submissions' entries
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
  db: DbClient,
  tournament: EntryTournamentRow,
  input: EntryInput,
  delivery: EntryMailDelivery = 'now',
): Promise<CreateEntryOutcome> {
  // Runs after the response, inside `waitUntil()`, where a throw would
  // surface as an unhandled rejection with none of the context below. So a
  // thrown error (a network failure inside the Supabase client, say) is
  // treated like any other failure on our side.
  //
  // A fault on our side is thrown (#378), and is a failure here like any
  // other: the message holds the context and the database's own message, and
  // a failure after a takeover still tells what the takeover withdrew.
  let result: AddressEntryResult | UnexpectedEntryResult;
  try {
    result = await createEntryAfterCheck(env, db, tournament, input, delivery);
  } catch (e) {
    result = {
      ok: false,
      status: 500,
      error: e instanceof Error ? e.message : String(e),
      ...(e instanceof FailureAfterTakeover &&
      e.withdrawnTournaments !== undefined
        ? {withdrawnTournaments: e.withdrawnTournaments}
        : {}),
    };
  }
  if (result.ok) {
    return {kind: 'created', entryId: result.entry.id};
  }

  const withdrawnTournaments =
    'withdrawnTournaments' in result ? result.withdrawnTournaments : undefined;
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
      withdrawnTournaments,
    );
    return {kind: 'failed', error: result.error};
  }
  if (
    !(await sendEntryNotice(
      env,
      input.email,
      tournament,
      reason,
      delivery,
      withdrawnTournaments,
    ))
  ) {
    return {kind: 'failed', error: 'failed to send the entry notice'};
  }
  return {kind: 'notified', reason};
}

/**
 * Sends an entry notice, logging rather than throwing a failure: it runs in
 * the background, with no one left to report to.
 * @param withdrawnTournaments As for `sendEntryNoticeEmail()`.
 * @return Whether the notice went out.
 */
async function sendEntryNotice(
  env: Bindings,
  email: string,
  tournament: EntryTournamentRow,
  reason: EntryNoticeReason,
  delivery: EntryMailDelivery,
  withdrawnTournaments: string[] | undefined,
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
        ...(withdrawnTournaments ? {withdrawnTournaments} : {}),
      });
    } else {
      await sendEntryNoticeEmail(
        env,
        email,
        tournamentName,
        reason,
        withdrawnTournaments,
      );
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
