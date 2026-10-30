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

/** A tournament's period and pause state, as `entryAvailability()` reads it. */
export interface EntryAvailabilityInput {
  entryOpensAt: string;
  entryClosesAt: string;
  entriesPaused: boolean;
}

/**
 * Where a tournament's entries stand at `now`:
 *
 * - `open`: within the period and taking entries
 * - `paused`: within the period, but staff paused taking entries (0039)
 * - `upcoming` / `closed`: before / after the period, paused or not
 *
 * The one place the pause and the period are combined, so the gate, the
 * entry form and the portal can't disagree about which a tournament is.
 * Only new entries go by this; edits, cancellations and confirmations of
 * entries already made go by the period alone.
 * @param tournament The tournament's period and pause state.
 * @param now The current time.
 */
export function entryAvailability(
  tournament: EntryAvailabilityInput,
  now: Date = new Date(),
): 'open' | 'paused' | 'upcoming' | 'closed' {
  if (
    isWithinEntryPeriod(tournament.entryOpensAt, tournament.entryClosesAt, now)
  ) {
    return tournament.entriesPaused ? 'paused' : 'open';
  }
  return now < new Date(tournament.entryOpensAt) ? 'upcoming' : 'closed';
}

/**
 * Whether a tournament is taking entries at `now` (`entryAvailability()` is
 * `open`): what decides whether the form is public and whether a new entry
 * is accepted.
 * @param tournament The tournament's period and pause state.
 * @param now The current time.
 */
export function isAcceptingEntries(
  tournament: EntryAvailabilityInput,
  now: Date = new Date(),
): boolean {
  return entryAvailability(tournament, now) === 'open';
}
