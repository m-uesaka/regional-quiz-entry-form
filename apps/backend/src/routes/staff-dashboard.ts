import {Hono} from 'hono';
import {
  DashboardTournamentSummarySchema,
  type DashboardTournamentSummary,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {type Database} from '../lib/db';
import {internalError} from '../lib/errors';
import {tournamentDisplayName} from '../lib/tournaments';

/** Shape of a `tournament_entry_summary()` row (snake_case). */
type TournamentEntrySummaryRow =
  Database['public']['Functions']['tournament_entry_summary']['Returns'][number];

function rowToSummary(
  row: TournamentEntrySummaryRow,
): DashboardTournamentSummary {
  return DashboardTournamentSummarySchema.parse({
    tournamentId: row.tournament_id,
    tournamentName: tournamentDisplayName(
      row.tournament_name,
      row.region_name,
      row.tournament_type,
    ),
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
    const db = c.get('db');
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
    const rows: TournamentEntrySummaryRow[] = data ?? [];
    return c.json(rows.map(rowToSummary));
  },
);
