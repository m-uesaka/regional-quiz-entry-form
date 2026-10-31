import {
  entryAvailability,
  TOURNAMENT_TYPE_LABELS,
  TournamentTypeSchema,
  type PortalTournament,
  type TournamentType,
} from '@regional-quiz/shared';
import {formatJstDateTime} from '$lib/jst-datetime';
import {
  priorityEntryNotices,
  type PriorityEntryNotice,
} from '$lib/priority-entry';

/**
 * Whether a tournament's entry form is taking entries. `paused` is within
 * the period but stopped by staff (0039).
 */
export type PortalStatus = 'open' | 'paused' | 'upcoming' | 'closed';

/** What the portal shows for each status. */
export const PORTAL_STATUS_LABELS: Record<PortalStatus, string> = {
  open: '受付中',
  paused: '一時中断中',
  upcoming: '受付開始前',
  closed: '受付終了',
};

/**
 * What the portal says under a region that lets one participant enter both
 * of its tournaments. It states the region's rule, not that both forms are
 * taking entries now: each tournament's own status says that.
 */
export const DUAL_ENTRY_NOTICE = `この地域は${TournamentTypeSchema.options
  .map(type => TOURNAMENT_TYPE_LABELS[type])
  .join('と')}の両方にエントリー可能です(重複エントリー可)`;

/** One tournament as the portal page renders it. */
export interface PortalTournamentView {
  name: string;
  typeLabel: string;
  status: PortalStatus;
  /** The entry period as the page prints it, in JST. */
  entryPeriodLabel: string;
  /** `定員: 48名`, or null for a tournament without a capacity. */
  capacityLabel: string | null;
  /** The 優先エントリー going on now; empty unless the form is open. */
  priorityNotices: PriorityEntryNotice[];
  /** The entry form, `/<regionSlug>/<tournamentType>/entry`. */
  entryPath: string;
  /** The published entry list, `/<regionSlug>/<tournamentType>/list`. */
  entryListPath: string;
}

/** The tournaments of one region, in the order the API listed them. */
export interface PortalRegionView {
  regionSlug: string;
  regionName: string;
  /**
   * Whether the portal shows `DUAL_ENTRY_NOTICE`: the region allows one
   * participant to enter both of its tournaments and lists one of each type.
   * With only one of them listed there is nothing to enter both of. Shown
   * whatever the forms' statuses, as it is the region's rule.
   */
  allowsDualEntry: boolean;
  tournaments: PortalTournamentView[];
}

/**
 * A tournament's public pages sit under `/<regionSlug>/<tournamentType>`:
 * the entry form at `/entry`, the published entry list at `/list`. Every
 * link to them is built from here, so they all agree on the encoding.
 * @param regionSlug The tournament's region slug.
 * @param tournamentType The tournament's type, used as the URL slug.
 */
export function tournamentPublicPath(
  regionSlug: string,
  tournamentType: TournamentType,
): string {
  return `/${encodeURIComponent(regionSlug)}/${tournamentType}`;
}

/**
 * The tournament's entry form, `/<regionSlug>/<tournamentType>/entry`.
 * @param regionSlug The tournament's region slug.
 * @param tournamentType The tournament's type, used as the URL slug.
 */
export function tournamentEntryFormPath(
  regionSlug: string,
  tournamentType: TournamentType,
): string {
  return `${tournamentPublicPath(regionSlug, tournamentType)}/entry`;
}

/**
 * The tournament's published entry list,
 * `/<regionSlug>/<tournamentType>/list`.
 * @param regionSlug The tournament's region slug.
 * @param tournamentType The tournament's type, used as the URL slug.
 */
export function tournamentEntryListPath(
  regionSlug: string,
  tournamentType: TournamentType,
): string {
  return `${tournamentPublicPath(regionSlug, tournamentType)}/list`;
}

/**
 * Says where a tournament's entries stand at `now`: `entryAvailability()`,
 * the same rule the backend's entry-period gate opens the form by.
 * @param tournament The tournament to check.
 * @param now The moment to check it at.
 */
export function portalStatus(
  tournament: Pick<
    PortalTournament,
    'entryOpensAt' | 'entryClosesAt' | 'entriesPaused'
  >,
  now: Date,
): PortalStatus {
  return entryAvailability(tournament, now);
}

/**
 * Groups the API's list into regions. Regions come out in the order each
 * first appears and tournaments in the order listed, so the API's sort is
 * kept; but the grouping itself doesn't rely on a region's tournaments
 * arriving next to each other, which would otherwise yield the same region
 * twice (and a duplicate `{#each}` key) if that sort ever changed.
 * @param tournaments The list from `GET /api/portal/tournaments`.
 * @param now The moment the statuses are worked out for.
 */
export function groupPortalTournaments(
  tournaments: PortalTournament[],
  now: Date,
): PortalRegionView[] {
  const regions = new Map<
    string,
    {
      view: Omit<PortalRegionView, 'allowsDualEntry'>;
      types: Set<TournamentType>;
      // Every row carries its region's setting; trust it only if they all
      // agree, so the answer can't depend on which row came last.
      allowsDualEntry: boolean;
    }
  >();
  for (const tournament of tournaments) {
    let region = regions.get(tournament.regionSlug);
    if (!region) {
      region = {
        view: {
          regionSlug: tournament.regionSlug,
          regionName: tournament.regionName,
          tournaments: [],
        },
        types: new Set(),
        allowsDualEntry: true,
      };
      regions.set(tournament.regionSlug, region);
    }
    region.types.add(tournament.tournamentType);
    region.allowsDualEntry &&= tournament.regionAllowsDualEntry;
    const status = portalStatus(tournament, now);
    region.view.tournaments.push({
      name: tournament.tournamentName,
      typeLabel: TOURNAMENT_TYPE_LABELS[tournament.tournamentType],
      status,
      entryPeriodLabel: `${formatJstDateTime(tournament.entryOpensAt)} 〜 ${formatJstDateTime(tournament.entryClosesAt)}`,
      capacityLabel:
        tournament.capacity === null ? null : `定員: ${tournament.capacity}名`,
      // A window can outlast the form it belongs to, and a closed form
      // takes no entries, prioritised or not.
      priorityNotices:
        status === 'open'
          ? priorityEntryNotices(
              tournament.priorityRegulations,
              now,
              tournament.entryClosesAt,
            )
          : [],
      entryPath: tournamentEntryFormPath(
        tournament.regionSlug,
        tournament.tournamentType,
      ),
      entryListPath: tournamentEntryListPath(
        tournament.regionSlug,
        tournament.tournamentType,
      ),
    });
  }
  return [...regions.values()].map(region => ({
    ...region.view,
    allowsDualEntry:
      region.allowsDualEntry &&
      region.types.size === TournamentTypeSchema.options.length,
  }));
}
