import type {EntryAvailabilityInput} from './entry-period';

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

/** A tournament's entry period, as the priority check reads it. */
export type EntryPeriod = Pick<
  EntryAvailabilityInput,
  'entryOpensAt' | 'entryClosesAt'
>;

/**
 * How far before the close a window may end and still count as running to
 * it. Sheets spell one close as 23:59, 23:59:59 and the next day's 0:00.
 */
const CLOSE_TOLERANCE_MS = 60_000;

/**
 * Whether the open windows are a tournament's last, general phase rather
 * than priority (#235): staff phase a tournament by giving the general
 * regulation a window from the end of the priority one up to the close.
 *
 * All of these have to hold, each ruling out a window that really restricts
 * who may enter:
 *
 * - No window is still to start: a later phase's regulation has to wait for
 *   it, and lifting the check now would only bring it back when that opens.
 * - Every open window runs to the close: one ending earlier leaves entries
 *   to come after it, so it gives priority over those.
 * - Each of them started once an earlier window was over: one alongside a
 *   window, or with none before it, restricts the whole of its own period.
 * - That earlier window ended after entries opened: one over before then
 *   let nobody in, so it is left over rather than a phase.
 * @param windows The tournament's priority windows.
 * @param active The ones open at `now`.
 * @param now The moment to check at.
 * @param entryPeriod The tournament's entry period.
 */
function isGeneralPhase(
  windows: readonly PriorityWindow[],
  active: readonly PriorityWindow[],
  now: Date,
  entryPeriod: EntryPeriod,
): boolean {
  if (windows.some(window => now < new Date(window.priorityStartsAt))) {
    return false;
  }
  const closesAt = Date.parse(entryPeriod.entryClosesAt);
  const opensAt = Date.parse(entryPeriod.entryOpensAt);
  const phaseEnds = windows
    .map(window => Date.parse(window.priorityEndsAt))
    .filter(endsAt => endsAt > opensAt && endsAt < now.getTime());
  return active.every(
    window =>
      Date.parse(window.priorityEndsAt) >= closesAt - CLOSE_TOLERANCE_MS &&
      phaseEnds.some(endsAt => endsAt <= Date.parse(window.priorityStartsAt)),
  );
}

/**
 * The regulations whose priority window is open at `now`, ends included --
 * the regulations a participant has to pick at least one of while any is
 * listed -- or none in a tournament's general phase (`isGeneralPhase()`).
 * Generic so a caller keeps whatever else its regulations carry (the label
 * the entry form and the portal print).
 * @param regulations The tournament's regulations.
 * @param now The moment to check at.
 * @param entryPeriod The tournament's entry period.
 */
export function activePriorityRegulations<
  T extends Omit<RegulationWindow, 'id'>,
>(
  regulations: readonly T[],
  now: Date,
  entryPeriod: EntryPeriod,
): Array<T & PriorityWindow> {
  const windows = regulations.filter(hasPriorityWindow);
  const active = windows.filter(
    regulation =>
      now >= new Date(regulation.priorityStartsAt) &&
      now <= new Date(regulation.priorityEndsAt),
  );
  return isGeneralPhase(windows, active, now, entryPeriod) ? [] : active;
}

/**
 * Determines whether `selectedRegulationIds` may be chosen at `now`.
 *
 * A participant may meet several of a tournament's conditions at once, so a
 * selection is a set rather than a single regulation. The rule itself is
 * unchanged from when it was one: if `activePriorityRegulations()` lists
 * any regulation, the selection has to contain at least one of them — the
 * window says only participants meeting that condition may enter, not that
 * they may claim nothing else. Where it lists none, any set of the
 * tournament's regulations goes: no window is open, or the tournament is in
 * its general phase, where one is open but no longer restricts anyone.
 *
 * An empty selection is never allowed: requirements.md asks for at least
 * one condition to be met.
 * @param regulations All regulations defined for the tournament.
 * @param selectedRegulationIds The regulations the participant wants to
 *     select.
 * @param now The current time.
 * @param entryPeriod The tournament's entry period.
 */
export function isRegulationSelectionAllowed(
  regulations: RegulationWindow[],
  selectedRegulationIds: readonly string[],
  now: Date,
  entryPeriod: EntryPeriod,
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
    entryPeriod,
  ).map(regulation => regulation.id);

  if (activePriorityIds.length === 0) return true;
  return selectedRegulationIds.some(selectedId =>
    activePriorityIds.includes(selectedId),
  );
}
