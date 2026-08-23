/** The subset of a regulation's fields this check depends on. */
export interface RegulationWindow {
  id: string;
  priorityStartsAt: string | null;
  priorityEndsAt: string | null;
}

interface ActiveRegulationWindow extends RegulationWindow {
  priorityStartsAt: string;
  priorityEndsAt: string;
}

function hasPriorityWindow(
  regulation: RegulationWindow,
): regulation is ActiveRegulationWindow {
  return (
    regulation.priorityStartsAt !== null && regulation.priorityEndsAt !== null
  );
}

/**
 * Determines whether `selectedRegulationId` may be chosen at `now`.
 *
 * If one or more regulations have a priority window that is currently
 * active, only those regulations may be selected. Otherwise any regulation
 * may be selected.
 * @param regulations All regulations defined for the tournament.
 * @param selectedRegulationId The regulation the participant wants to select.
 * @param now The current time.
 */
export function isRegulationSelectionAllowed(
  regulations: RegulationWindow[],
  selectedRegulationId: string,
  now: Date,
): boolean {
  const isKnownRegulation = regulations.some(
    regulation => regulation.id === selectedRegulationId,
  );
  if (!isKnownRegulation) return false;

  const activePriorityIds = regulations
    .filter(hasPriorityWindow)
    .filter(
      regulation =>
        now >= new Date(regulation.priorityStartsAt) &&
        now <= new Date(regulation.priorityEndsAt),
    )
    .map(regulation => regulation.id);

  if (activePriorityIds.length === 0) return true;
  return activePriorityIds.includes(selectedRegulationId);
}
