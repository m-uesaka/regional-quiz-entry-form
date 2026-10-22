import type {StaffClaims} from '../schemas/staff';
import type {TournamentType} from '../schemas/tournament';

/** The parts of a tournament a staff member's scope is judged against. */
export interface TournamentScope {
  regionId: string;
  type: TournamentType;
}

/**
 * Whether `staff` may see a tournament whose entry period is not open.
 *
 * 統括スタッフ (`general`) cover every tournament; 地域スタッフ
 * (`regional`) are scoped to one region × tournament type and have no
 * reason to read another region's unpublished form. Both the backend
 * (`middleware/entry-period.ts`, via `isInScope()`) and the frontend's
 * entry-form `load` decide with this function, so the two cannot drift
 * apart.
 *
 * @param staff The viewer's session claims, or `null` for a visitor with
 *     no staff session.
 * @param tournament The tournament being asked for.
 */
export function canPreviewTournament(
  staff: StaffClaims | null,
  tournament: TournamentScope,
): boolean {
  if (!staff) return false;
  if (staff.role === 'general') return true;
  return (
    staff.regionId === tournament.regionId &&
    staff.tournamentType === tournament.type
  );
}
