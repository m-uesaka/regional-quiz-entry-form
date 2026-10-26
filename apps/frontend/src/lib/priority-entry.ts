import {
  activePriorityRegulations,
  type Regulation,
  type TournamentEntryCounts,
} from '@regional-quiz/shared';
import {formatJstDateTime} from '$lib/jst-datetime';

/** A regulation's priority window, as both the portal and the form get it. */
export type PriorityRegulation = Pick<
  Regulation,
  'label' | 'priorityStartsAt' | 'priorityEndsAt'
>;

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
 * "Together" is as the page prints it -- to the minute -- so two ends the
 * page can't tell apart (seconds apart, or one instant spelt two ways) are
 * one notice rather than two identical-looking lines.
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
  const active = activePriorityRegulations(regulations, now).sort(
    (a, b) => Date.parse(a.priorityEndsAt) - Date.parse(b.priorityEndsAt),
  );
  const byEnd = new Map<string, string[]>();
  for (const regulation of active) {
    const endsAtLabel = formatJstDateTime(regulation.priorityEndsAt);
    const labels = byEnd.get(endsAtLabel) ?? [];
    labels.push(regulation.label);
    byEnd.set(endsAtLabel, labels);
  }
  return [...byEnd].map(([endsAtLabel, labels]) => ({labels, endsAtLabel}));
}

/**
 * Whether a new entry would join the waitlist: every seat is taken. This is
 * the rule `confirm_entry_by_token()` (0008) applies, so entries already
 * waiting don't count by themselves -- after the capacity is raised there
 * can be some while seats are free, and a new entry gets one of those.
 * Only a tournament with a capacity has a waitlist.
 * @param capacity The tournament's capacity, or null when uncapped.
 * @param counts The tournament's confirmed and waitlisted entries.
 */
export function isWaitlistOpen(
  capacity: number | null,
  counts: TournamentEntryCounts,
): boolean {
  if (capacity === null) return false;
  return counts.confirmedCount >= capacity;
}
