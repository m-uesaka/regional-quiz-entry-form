import type {EntryStatus} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';

// PostgREST caps every response at the project's `db-max-rows`, so a single
// unbounded select silently stops at that many entries. Recipients are
// therefore read one explicit page at a time until a short page arrives.
// Keep this at or below the configured `db-max-rows`, or the last row of
// each page would be dropped rather than paged over.
export const RECIPIENT_PAGE_SIZE = 500;

/**
 * Who a send with no `statusFilter` reaches: the entries whose owner proved
 * the address theirs by confirming it, seated or waiting.
 *
 * Not `pending_verification` (#192): anyone can enter under a stranger's
 * address and leave the entry unconfirmed, and an announcement -- the venue,
 * the meeting time -- would then reach someone who never agreed to it, from
 * the organization's sending domain. Nor `cancelled`: someone who withdrew
 * shouldn't keep receiving announcements. Either is still reachable by
 * naming it in `statusFilter`.
 */
export const DEFAULT_RECIPIENT_STATUSES: readonly EntryStatus[] = [
  'confirmed',
  'waitlisted',
];

type RecipientsResult =
  {ok: true; recipients: string[]} | {ok: false; error: string};

/** Shape of the `entries` rows selected for their participant's address. */
interface RecipientRow {
  participants: {email: string} | null;
}

/**
 * Collects the addresses to mail for one tournament's entries.
 *
 * With no `statusFilter`, the entries in `DEFAULT_RECIPIENT_STATUSES` are
 * included -- not the unconfirmed or the cancelled ones, which take an
 * explicit `statusFilter` to reach.
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
  statusFilter?: EntryStatus,
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
      .select('participants(email)')
      .eq('tournament_id', tournamentId);
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
      // An entry whose participant row is missing has no address to mail.
      if (row.participants) {
        recipients.add(row.participants.email);
      }
    }
    if (rows.length < pageSize) {
      return {ok: true, recipients: [...recipients]};
    }
  }
}
