import type {EntryStatus, StaffMailStatusFilter} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';

// PostgREST caps every response at the project's `db-max-rows`, so a single
// unbounded select silently stops at that many entries. Recipients are
// therefore read one explicit page at a time until a short page arrives.
// Keep this at or below the configured `db-max-rows`, or the last row of
// each page would be dropped rather than paged over.
export const RECIPIENT_PAGE_SIZE = 500;

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

type RecipientsResult =
  {ok: true; recipients: string[]} | {ok: false; error: string};

/** Shape of the `entries` rows selected for their participant's address. */
interface RecipientRow {
  participants: {email: string};
}

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
 * @param pageSize Rows to read per request; must be a positive integer.
 * @throws RangeError If `pageSize` is not a positive integer.
 */
export async function fetchTournamentRecipients(
  env: Bindings,
  tournamentId: string,
  statusFilter?: StaffMailStatusFilter,
  pageSize: number = RECIPIENT_PAGE_SIZE,
): Promise<RecipientsResult> {
  // A page size of 0 (or a fractional/negative one) would have every request
  // come back empty without ever satisfying the short-page check below, i.e.
  // an endless request loop, so reject it up front rather than hanging the
  // caller.
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError(
      `pageSize must be a positive integer, got ${pageSize}`,
    );
  }

  const db = createDbClient(env);
  const recipients = new Set<string>();

  for (let page = 0; ; page++) {
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

    const {data, error} = await query
      // Ordered by the primary key so the pages partition the rows instead
      // of overlapping: without an order PostgREST makes no promise that
      // two ranges see the same row order.
      .order('id', {ascending: true})
      .range(page * pageSize, (page + 1) * pageSize - 1)
      .returns<RecipientRow[]>();
    if (error) {
      return {ok: false, error: error.message};
    }

    const rows = data ?? [];
    for (const row of rows) {
      recipients.add(row.participants.email);
    }
    if (rows.length < pageSize) {
      return {ok: true, recipients: [...recipients]};
    }
  }
}
