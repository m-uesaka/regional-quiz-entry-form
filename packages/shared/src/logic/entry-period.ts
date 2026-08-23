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
