/**
 * Determines whether `now` falls within a tournament's entry period.
 * @param opensAt The entry period's opening timestamp (ISO 8601).
 * @param closesAt The entry period's closing timestamp (ISO 8601).
 * @param now The current time.
 */
export function isWithinEntryPeriod(
  opensAt: string,
  closesAt: string,
  now: Date = new Date(),
): boolean {
  return now >= new Date(opensAt) && now <= new Date(closesAt);
}

/**
 * Determines whether a tournament is taking entries at `now`: within its
 * entry period and not paused by staff (0039). What decides whether the form
 * is public and whether a new entry is accepted; edits, cancellations and
 * confirmations of entries already made go by the period alone.
 * @param tournament The tournament's period and pause state.
 * @param now The current time.
 */
export function isAcceptingEntries(
  tournament: {
    entryOpensAt: string;
    entryClosesAt: string;
    entriesPaused: boolean;
  },
  now: Date = new Date(),
): boolean {
  return (
    !tournament.entriesPaused &&
    isWithinEntryPeriod(tournament.entryOpensAt, tournament.entryClosesAt, now)
  );
}
