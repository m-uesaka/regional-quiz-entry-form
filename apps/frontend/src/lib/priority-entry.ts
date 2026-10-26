import {
  activePriorityRegulations,
  type TournamentEntryCounts,
} from '@regional-quiz/shared';
import {formatJstDateTime} from '$lib/jst-datetime';

/** A regulation's priority window, as both the portal and the form get it. */
export interface PriorityRegulation {
  label: string;
  priorityStartsAt: string | null;
  priorityEndsAt: string | null;
}

/**
 * One 優先エントリー announcement: the regulations being given priority
 * until the same moment.
 */
export interface PriorityEntryNotice {
  labels: string[];
  /** When the window ends, as the page prints it, in JST. */
  endsAtLabel: string;
}

/**
 * The 優先エントリー windows open at `now`, as the portal and the entry form
 * announce them. Regulations whose windows end together are announced
 * together; ones ending at different moments get one notice each, earliest
 * first, so no regulation is said to be prioritised longer than it is.
 *
 * Worked out on the server, like the portal's statuses, so the server
 * rendering and the hydrated page agree.
 * @param regulations The tournament's regulations, in display order.
 * @param now The moment to check at.
 */
export function priorityEntryNotices(
  regulations: readonly PriorityRegulation[],
  now: Date,
): PriorityEntryNotice[] {
  const byEnd = new Map<string, string[]>();
  for (const regulation of activePriorityRegulations(regulations, now)) {
    const labels = byEnd.get(regulation.priorityEndsAt) ?? [];
    labels.push(regulation.label);
    byEnd.set(regulation.priorityEndsAt, labels);
  }
  return [...byEnd]
    .sort(([a], [b]) => Date.parse(a) - Date.parse(b))
    .map(([endsAt, labels]) => ({
      labels,
      endsAtLabel: formatJstDateTime(endsAt),
    }));
}

/**
 * Whether a new entry would join the waitlist: entries are already waiting,
 * or every seat is taken. Only a tournament with a capacity has a waitlist.
 * @param capacity The tournament's capacity, or null when uncapped.
 * @param counts The tournament's confirmed and waitlisted entries.
 */
export function isWaitlistOpen(
  capacity: number | null,
  counts: TournamentEntryCounts,
): boolean {
  if (capacity === null) return false;
  return counts.waitlistedCount > 0 || counts.confirmedCount >= capacity;
}
