import type {EntryStatus, StaffMailStatusFilter} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import type {InternalFailure} from './errors';
import {fetchAllRows, SELECT_PAGE_SIZE} from './paged-select';

/**
 * Who a send with no `statusFilter` reaches: the entries whose owner
 * confirmed them, seated or waiting.
 *
 * Not `cancelled`: someone who withdrew shouldn't keep receiving
 * announcements, and mailing them takes a deliberate `statusFilter`. Nor
 * `pending_verification`, which no bulk send reaches at all (#192, see
 * `StaffMailInputSchema`).
 *
 * This is an allow-list, so a status added to `EntryStatusSchema` later is
 * left out of the default until someone decides otherwise -- the test pins
 * every status to either this list or `DEFAULT_EXCLUDED_STATUSES`, so that
 * decision can't be skipped.
 */
export const DEFAULT_RECIPIENT_STATUSES: readonly EntryStatus[] = [
  'confirmed',
  'waitlisted',
];

/** The statuses a send with no `statusFilter` leaves out, on purpose. */
export const DEFAULT_EXCLUDED_STATUSES: readonly EntryStatus[] = [
  'pending_verification',
  'cancelled',
];

type RecipientsResult = {ok: true; recipients: string[]} | InternalFailure;

/**
 * Collects the addresses to mail for one tournament's entries.
 *
 * With no `statusFilter`, the entries in `DEFAULT_RECIPIENT_STATUSES` are
 * included; the cancelled ones take an explicit `statusFilter` to reach.
 *
 * Whatever the status, only participants who have confirmed their address
 * (`participants.email_verified_at`) are included. The status alone would
 * stand in for that only as long as every way into `confirmed` or
 * `waitlisted` went through the confirmation link; checking the address
 * itself keeps #192 closed if some other path -- a staff override, an
 * import -- ever sets the status directly.
 *
 * Addresses are de-duplicated, so a participant holding more than one
 * matching entry is still mailed once.
 * @param env The Worker bindings.
 * @param tournamentId The tournament whose entries to mail.
 * @param statusFilter The single entry status to narrow the recipients to.
 * @param pageSize Rows to read per request; see `fetchAllRows()`.
 * @throws RangeError If `pageSize` is not a positive integer.
 */
export async function fetchTournamentRecipients(
  env: Bindings,
  tournamentId: string,
  statusFilter?: StaffMailStatusFilter,
  pageSize: number = SELECT_PAGE_SIZE,
): Promise<RecipientsResult> {
  const db = createDbClient(env);
  // Paged through `fetchAllRows()` because the Data API silently trims a
  // single response to its `max_rows`; that helper only stops on an empty
  // page, so a hosted `max_rows` below the page size still reaches every
  // recipient (#292).
  const result = await fetchAllRows((from, to) => {
    let query = db
      .from('entries')
      // `!inner` so the filter on the participant drops the entry itself,
      // rather than only blanking out its embedded participant.
      .select('participants!inner(email)')
      .eq('tournament_id', tournamentId)
      .not('participants.email_verified_at', 'is', null);
    query = statusFilter
      ? query.eq('status', statusFilter)
      : query.in('status', [...DEFAULT_RECIPIENT_STATUSES]);
    // Ordered by the primary key so the pages partition the rows instead
    // of overlapping: without an order PostgREST makes no promise that two
    // ranges see the same row order.
    return query.order('id', {ascending: true}).range(from, to);
  }, pageSize);
  if (result.error) {
    return {ok: false, status: 500, error: result.error.message};
  }

  // De-duplicated: a participant holding several matching entries is
  // mailed once.
  const recipients = new Set(result.rows.map(row => row.participants.email));
  return {ok: true, recipients: [...recipients]};
}
