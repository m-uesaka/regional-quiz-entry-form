/**
 * The `error` strings the entry flow's API answers with, named once so the
 * backend that sends them and the entry form that translates them can't
 * drift apart. The values are the wire format and clients on an old tab still
 * match on them, so they stay as they are even where the wording has aged;
 * rename a key, never a value.
 */
export const ENTRY_ERROR_CODES = {
  INVALID_TOURNAMENT: 'invalid tournament',
  ENTRY_PERIOD_CLOSED: 'entry period closed',
  /**
   * An edit of an entry that was cancelled while the edit form was open: the
   * only status `EDITABLE_ENTRY_STATUSES` leaves out. Said apart from
   * `ENTRY_PERIOD_CLOSED`, which refuses an edit with the same 403.
   */
  ENTRY_CANCELLED: 'entry is cancelled',
  /** Paused by staff (0039), said apart from being outside the period. */
  ENTRIES_PAUSED: 'entries paused',
  REGULATION_NOT_ELIGIBLE: 'regulation not eligible in priority window',
  /**
   * What a submission naming a regulation that is no longer on offer answers
   * with. Reached when the form was left open past the end of a priority
   * phase (`selectableRegulations()`) or a regulation staff then deleted, or
   * when a refused `entry_regulations`
   * write shows the regulation stopped existing between
   * `regulationSelectionRefusal()` and the write — a `sync_regulations()`
   * call that dropped it. Either way it is a conflict with a change, not a
   * malformed submission. Spelled out rather than passing the constraint
   * violation through, so the entry form has something stable to translate.
   */
  REGULATION_NO_LONGER_AVAILABLE: 'regulation no longer available',
  /**
   * The error the dual-entry rule answers with, from both the check and the
   * trigger's SQLSTATE mapping, so the entry form has one string to translate.
   */
  ALREADY_ENTERED_ANOTHER_TOURNAMENT:
    'already entered another tournament in this region',
  INVALID_PASSWORD: 'invalid password',
  /**
   * Named after the rule it first stood for, and kept as the frontend matches
   * on it: it now means taking part in another region (#236).
   */
  ALREADY_REGISTERED_IN_ANOTHER_REGION: 'already registered in another region',
  ALREADY_ENTERED: 'already entered',
  /**
   * An entry for the tournament is waiting on a verification link that is
   * still valid. Told apart from `ALREADY_ENTERED` so the participant is sent
   * to that mail rather than to an entry that isn't confirmed yet (#172).
   */
  ENTRY_PENDING_VERIFICATION: 'entry pending verification',
  COMMON_PASSWORD: 'password too common',
  /**
   * A later submission under the same unverified address took the account
   * over while this one was being entered (`isStillUnverifiedAccountOf()`).
   * Not one of the notice reasons: the later submission sends its own mail,
   * and this one is answered like any other failure on our side.
   */
  SUPERSEDED_BY_LATER_SUBMISSION: 'superseded by a later submission',
  /**
   * Another submission for the same address -- or the same participant and
   * tournament -- wrote its row first, and the database refused this one's.
   * Spelled out instead of passing the refusal on: Postgres' message names
   * the table and the constraint, and the logged-in route answers 4xx
   * messages as they are (#191). Like `SUPERSEDED_BY_LATER_SUBMISSION`, not a
   * notice reason: the anonymous route answers it like any other failure on
   * our side, logging it and mailing `processing-failed` alongside the
   * winner's own mail.
   */
  CONCURRENT_SUBMISSION: 'concurrent submission',
  /** From the challenge in front of the API. */
  TURNSTILE_VERIFICATION_FAILED: 'turnstile verification failed',
  /** From the rate limit in front of the API. */
  TOO_MANY_REQUESTS: 'too many requests',
} as const;

/** One of the `error` strings in `ENTRY_ERROR_CODES`. */
export type EntryErrorCode =
  (typeof ENTRY_ERROR_CODES)[keyof typeof ENTRY_ERROR_CODES];

const ENTRY_ERROR_CODE_VALUES: ReadonlySet<string> = new Set(
  Object.values(ENTRY_ERROR_CODES),
);

/**
 * Whether an `error` string from the API is one of `ENTRY_ERROR_CODES`. A
 * client has to ask: the string comes over the wire, and may come from a
 * newer backend or from something in front of it.
 * @param code The `error` string.
 */
export function isEntryErrorCode(code: string): code is EntryErrorCode {
  return ENTRY_ERROR_CODE_VALUES.has(code);
}
