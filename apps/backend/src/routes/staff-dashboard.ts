import {Hono} from 'hono';
import {
  DashboardTournamentSummarySchema,
  type DashboardTournamentSummary,
  type TournamentType,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {createDbClient} from '../lib/db';
import {internalError} from '../lib/errors';

/** Shape of a `tournament_entry_summary()` row (snake_case). */
interface TournamentEntrySummaryRow {
  tournament_id: string;
  tournament_name: string;
  tournament_type: TournamentType;
  region_id: string;
  region_slug: string;
  region_name: string;
  capacity: number | null;
  confirmed_count: number;
  waitlisted_count: number;
  pending_verification_count: number;
  cancelled_count: number;
}

function rowToSummary(
  row: TournamentEntrySummaryRow,
): DashboardTournamentSummary {
  return DashboardTournamentSummarySchema.parse({
    tournamentId: row.tournament_id,
    tournamentName: row.tournament_name,
    tournamentType: row.tournament_type,
    regionId: row.region_id,
    regionSlug: row.region_slug,
    regionName: row.region_name,
    capacity: row.capacity,
    confirmedCount: row.confirmed_count,
    waitlistedCount: row.waitlisted_count,
    pendingVerificationCount: row.pending_verification_count,
    cancelledCount: row.cancelled_count,
  });
}

// The cross-region dashboard. `requireGeneralStaff()` rather than
// `requireStaffForTournament()` because there is no single tournament to
// scope against: the whole point of this endpoint is that it spans every
// region, which regional staff may not see.
export const staffDashboardRoute = new Hono<StaffEnv>().get(
  '/dashboard',
  requireGeneralStaff(),
  async c => {
    const db = createDbClient(c.env);
    // Aggregating in the DB keeps this to one round trip: counting in the
    // Worker would mean either one `entries` query per tournament or
    // pulling every entry row across every region just to bucket it by
    // status. One row comes back per tournament (regions x tournament
    // types), which stays well under Supabase's `max_rows` cap, so unlike
    // the entry CSV export this needs no paging.
    const {data, error} = await db.rpc('tournament_entry_summary');
    if (error) {
      return c.json(
        internalError('failed to aggregate the dashboard summary', error),
        500,
      );
    }
    // Same reason as `lib/waitlist.ts`: `db` isn't constructed with
    // generated `Database` types, so an untyped `.rpc()` result can't be
    // narrowed with `.returns<T>()` and is asserted here instead. The shape
    // is re-checked at runtime by `rowToSummary()`'s `.parse()`.
    const rows = (data as TournamentEntrySummaryRow[] | null) ?? [];
    return c.json(rows.map(rowToSummary));
  },
);
