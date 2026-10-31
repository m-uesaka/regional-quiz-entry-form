/** The subset of a regulation's fields this check depends on. */
export interface RegulationWindow {
  id: string;
  priorityStartsAt: string | null;
  priorityEndsAt: string | null;
}

/** Just a regulation's priority window, both ends set. */
export interface PriorityWindow {
  priorityStartsAt: string;
  priorityEndsAt: string;
}

function hasPriorityWindow<T extends Omit<RegulationWindow, 'id'>>(
  regulation: T,
): regulation is T & PriorityWindow {
  return (
    regulation.priorityStartsAt !== null && regulation.priorityEndsAt !== null
  );
}

const MS_PER_MINUTE = 60_000;

/**
 * An instant rounded down to the minute, the precision windows and entry
 * periods are entered and printed at. JST is a whole number of hours ahead
 * of UTC, so rounding the UTC instant is the same as rounding the JST one.
 * @param iso The instant.
 */
export function wholeMinute(iso: string): number {
  return Math.floor(Date.parse(iso) / MS_PER_MINUTE);
}

/**
 * The regulations whose priority window is open at `now`, ends included --
 * the regulations a participant has to pick at least one of while any is
 * listed. Generic so a caller keeps whatever else its regulations carry
 * (the label the entry form and the portal print).
 *
 * Nothing is listed once a window has ended and every open one runs to the
 * close of entries. Staff phase a tournament by giving the general
 * regulation a window from the end of the priority one up to the close
 * (#235), and with the priority over and nobody left to come after it, that
 * is normal entry. A window with none ended before it stays listed, as it
 * is then the only regulation the tournament takes, however long it runs.
 * While a shorter window is open alongside one, both stay listed, so the
 * close-reaching window doesn't turn away those it has let in so far.
 * "To the close" is to the minute, as the sheets spell the same close both
 * as 23:59 and as 23:59:59.
 * @param regulations The tournament's regulations.
 * @param now The moment to check at.
 * @param entryClosesAt When the tournament stops taking entries.
 */
export function activePriorityRegulations<
  T extends Omit<RegulationWindow, 'id'>,
>(
  regulations: readonly T[],
  now: Date,
  entryClosesAt: string,
): Array<T & PriorityWindow> {
  const windows = regulations.filter(hasPriorityWindow);
  const active = windows.filter(
    regulation =>
      now >= new Date(regulation.priorityStartsAt) &&
      now <= new Date(regulation.priorityEndsAt),
  );
  const priorityEnded = windows.some(
    regulation => now > new Date(regulation.priorityEndsAt),
  );
  const closeMinute = wholeMinute(entryClosesAt);
  return priorityEnded &&
    active.every(
      regulation => wholeMinute(regulation.priorityEndsAt) >= closeMinute,
    )
    ? []
    : active;
}

/**
 * Determines whether `selectedRegulationIds` may be chosen at `now`.
 *
 * A participant may meet several of a tournament's conditions at once, so a
 * selection is a set rather than a single regulation. The rule itself is
 * unchanged from when it was one: if one or more regulations have a
 * priority window that is currently active, the selection has to contain at
 * least one of them — the window says only participants meeting that
 * condition may enter, not that they may claim nothing else. Where no
 * window is active, any set of the tournament's regulations goes.
 *
 * An empty selection is never allowed: requirements.md asks for at least
 * one condition to be met.
 * @param regulations All regulations defined for the tournament.
 * @param selectedRegulationIds The regulations the participant wants to
 *     select.
 * @param now The current time.
 * @param entryClosesAt When the tournament stops taking entries.
 */
export function isRegulationSelectionAllowed(
  regulations: RegulationWindow[],
  selectedRegulationIds: readonly string[],
  now: Date,
  entryClosesAt: string,
): boolean {
  if (selectedRegulationIds.length === 0) return false;
  // Every selected id has to name one of this tournament's regulations.
  // The composite foreign key behind `entry_regulations` would refuse an
  // outsider anyway, but as a constraint violation rather than as the
  // refusal the entry form can explain.
  const allKnown = selectedRegulationIds.every(selectedId =>
    regulations.some(regulation => regulation.id === selectedId),
  );
  if (!allKnown) return false;

  const activePriorityIds = activePriorityRegulations(
    regulations,
    now,
    entryClosesAt,
  ).map(regulation => regulation.id);

  if (activePriorityIds.length === 0) return true;
  return selectedRegulationIds.some(selectedId =>
    activePriorityIds.includes(selectedId),
  );
}
