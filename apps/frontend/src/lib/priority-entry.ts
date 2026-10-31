import {
  activePriorityRegulations,
  type Regulation,
  type TournamentEntryCounts,
  wholeMinute,
} from '@regional-quiz/shared';
import {formatJstDateTime} from '$lib/jst-datetime';

/** A regulation's priority window, as both the portal and the form get it. */
export type PriorityRegulation = Pick<
  Regulation,
  'label' | 'priorityStartsAt' | 'priorityEndsAt'
>;

/**
 * One 優先エントリー announcement: the regulations being given priority
 * over the same window.
 */
export interface PriorityEntryNotice {
  labels: string[];
  /** When the window starts, as the page prints it, in JST. */
  startsAtLabel: string;
  /** When the window ends, as the page prints it, in JST. */
  endsAtLabel: string;
}

/**
 * The 優先エントリー windows open at `now`, as the portal and the entry form
 * announce them. Regulations whose windows start and end together are
 * announced together; any other window gets a notice of its own, ordered by
 * end and then by start, earliest first, so no regulation is said to be
 * prioritised over a window it isn't. "Together" is as the page prints it
 * -- to the minute -- so two moments the page can't tell apart (seconds
 * apart, or one instant spelt two ways) make one notice rather than two
 * identical-looking lines.
 *
 * A window running to the close of entries is normal entry rather than
 * 優先エントリー, and goes unannounced (`activePriorityRegulations()`).
 *
 * Worked out on the server, like the portal's statuses, so the server
 * rendering and the hydrated page agree.
 * @param regulations The tournament's regulations, in display order.
 * @param now The moment to check at.
 * @param entryClosesAt When the tournament stops taking entries.
 */
export function priorityEntryNotices(
  regulations: readonly PriorityRegulation[],
  now: Date,
  entryClosesAt: string,
): PriorityEntryNotice[] {
  // Ordered at the precision the notices are grouped and printed at, so a
  // difference the page doesn't show can't reorder them. The sort is
  // stable, so the regulations inside one notice keep their display order.
  const active = activePriorityRegulations(
    regulations,
    now,
    entryClosesAt,
  ).sort(
    (a, b) =>
      wholeMinute(a.priorityEndsAt) - wholeMinute(b.priorityEndsAt) ||
      wholeMinute(a.priorityStartsAt) - wholeMinute(b.priorityStartsAt),
  );
  const byWindow = new Map<string, PriorityEntryNotice>();
  for (const regulation of active) {
    const startsAtLabel = formatJstDateTime(regulation.priorityStartsAt);
    const endsAtLabel = formatJstDateTime(regulation.priorityEndsAt);
    const key = `${startsAtLabel}〜${endsAtLabel}`;
    const notice = byWindow.get(key);
    if (notice) {
      notice.labels.push(regulation.label);
    } else {
      byWindow.set(key, {
        labels: [regulation.label],
        startsAtLabel,
        endsAtLabel,
      });
    }
  }
  return [...byWindow.values()];
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
