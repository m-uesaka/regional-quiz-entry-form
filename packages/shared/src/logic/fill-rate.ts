/**
 * How full a tournament is: the share of its capacity already taken by
 * confirmed entries, as a ratio (`0.5` for half full). Shared so the staff
 * dashboard and any later report agree on what "充足率" means -- in
 * particular that only `confirmed` entries occupy a seat, since waitlisted
 * and unverified entries hold none.
 *
 * The ratio can exceed 1 only if the capacity was lowered after entries
 * were confirmed; it is deliberately not clamped, so an over-subscribed
 * tournament is visible as such rather than looking exactly full.
 * @param confirmedCount The tournament's confirmed entry count.
 * @param capacity The tournament's capacity, or null when uncapped.
 * @return The fill ratio, or null when the tournament has no capacity to
 *     be measured against.
 */
export function calculateFillRate(
  confirmedCount: number,
  capacity: number | null,
): number | null {
  if (capacity === null || capacity <= 0) {
    return null;
  }
  return confirmedCount / capacity;
}
