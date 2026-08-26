import {z} from 'zod';
import {TournamentTypeSchema} from './tournament';

// One row of the general-staff dashboard (`GET /api/staff/dashboard`): a
// single tournament's entry counts by status, plus the region and
// tournament identity the dashboard groups and links by. Backed by the
// `tournament_entry_summary()` DB function, which reports every tournament
// including those nobody has entered yet (all counts zero).
//
// `capacity` is nullable because a tournament may be uncapped, in which
// case there is no fill rate to compute -- see `calculateFillRate()`.
export const DashboardTournamentSummarySchema = z.object({
  tournamentId: z.string().uuid(),
  tournamentName: z.string(),
  tournamentType: TournamentTypeSchema,
  regionId: z.string().uuid(),
  regionSlug: z.string(),
  regionName: z.string(),
  capacity: z.number().int().positive().nullable(),
  confirmedCount: z.number().int().nonnegative(),
  waitlistedCount: z.number().int().nonnegative(),
  pendingVerificationCount: z.number().int().nonnegative(),
  cancelledCount: z.number().int().nonnegative(),
});
export type DashboardTournamentSummary = z.infer<
  typeof DashboardTournamentSummarySchema
>;
