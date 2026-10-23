import {
  isWithinEntryPeriod,
  TOURNAMENT_TYPE_LABELS,
  type PortalTournament,
} from '@regional-quiz/shared';

/** Whether a tournament's entry form is taking entries. */
export type PortalStatus = 'open' | 'upcoming' | 'closed';

/** What the portal shows for each status. */
export const PORTAL_STATUS_LABELS: Record<PortalStatus, string> = {
  open: '受付中',
  upcoming: '受付開始前',
  closed: '受付終了',
};

/** One tournament as the portal page renders it. */
export interface PortalTournamentView {
  name: string;
  typeLabel: string;
  status: PortalStatus;
  entryOpensAt: string;
  entryClosesAt: string;
  /** The entry form, `/<regionSlug>/<tournamentType>/entry`. */
  entryPath: string;
}

/** The tournaments of one region, in the order the API listed them. */
export interface PortalRegionView {
  regionSlug: string;
  regionName: string;
  tournaments: PortalTournamentView[];
}

/**
 * Says where a tournament's entry period stands at `now`, using the same
 * inclusive window the backend's entry-period gate opens the form for.
 * @param tournament The tournament to check.
 * @param now The moment to check it at.
 */
export function portalStatus(
  tournament: Pick<PortalTournament, 'entryOpensAt' | 'entryClosesAt'>,
  now: Date,
): PortalStatus {
  if (
    isWithinEntryPeriod(tournament.entryOpensAt, tournament.entryClosesAt, now)
  ) {
    return 'open';
  }
  return now.getTime() < Date.parse(tournament.entryOpensAt)
    ? 'upcoming'
    : 'closed';
}

/**
 * Groups the API's list into regions, keeping its order: the API sorts by
 * region, so a region's tournaments arrive next to each other.
 * @param tournaments The list from `GET /api/portal/tournaments`.
 * @param now The moment the statuses are worked out for.
 */
export function groupPortalTournaments(
  tournaments: PortalTournament[],
  now: Date,
): PortalRegionView[] {
  const regions: PortalRegionView[] = [];
  for (const tournament of tournaments) {
    let region = regions.at(-1);
    if (region?.regionSlug !== tournament.regionSlug) {
      region = {
        regionSlug: tournament.regionSlug,
        regionName: tournament.regionName,
        tournaments: [],
      };
      regions.push(region);
    }
    region.tournaments.push({
      name: tournament.tournamentName,
      typeLabel: TOURNAMENT_TYPE_LABELS[tournament.tournamentType],
      status: portalStatus(tournament, now),
      entryOpensAt: tournament.entryOpensAt,
      entryClosesAt: tournament.entryClosesAt,
      entryPath: `/${encodeURIComponent(tournament.regionSlug)}/${tournament.tournamentType}/entry`,
    });
  }
  return regions;
}
