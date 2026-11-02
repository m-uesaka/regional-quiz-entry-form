/** The subset of a regulation's fields this check depends on. */
export interface RegulationWindow {
  id: string;
  priorityStartsAt: string | null;
  priorityEndsAt: string | null;
  closesWithPriority: boolean;
}

/** Just a regulation's priority window, both ends set. */
export interface PriorityWindow {
  priorityStartsAt: string;
  priorityEndsAt: string;
  closesWithPriority: boolean;
}

function hasPriorityWindow<T extends Omit<RegulationWindow, 'id'>>(
  regulation: T,
): regulation is T & PriorityWindow {
  return (
    regulation.priorityStartsAt !== null && regulation.priorityEndsAt !== null
  );
}

/**
 * The windows open at `now`, ends included.
 * @param windows The windows to look through.
 * @param now The moment to check at.
 */
function openWindows<T extends PriorityWindow>(
  windows: readonly T[],
  now: Date,
): T[] {
  return windows.filter(
    window =>
      now >= new Date(window.priorityStartsAt) &&
      now <= new Date(window.priorityEndsAt),
  );
}

/**
 * Whether the phases staff marked to close (`closesWithPriority`) are all
 * over: at least one is marked, every marked one has ended, and no window of
 * any kind is still to start. Staff phase a tournament by marking its
 * priority regulations; the general regulation needs no window of its own
 * (#243).
 *
 * The drop waits for all of them, rather than each regulation going at its
 * own end, so an earlier phase stays on offer beside a later one and through
 * a gap before a window still to come. That is what running tournaments
 * already do, and 0042 only records which regulations this applies to; going
 * regulation by regulation would change who may enter them. Staff close such
 * a gap by clearing the later window.
 * @param windows The tournament's priority windows.
 * @param now The moment to check at.
 */
function arePhasesOver(windows: readonly PriorityWindow[], now: Date): boolean {
  const closing = windows.filter(window => window.closesWithPriority);
  return (
    closing.length > 0 &&
    closing.every(window => new Date(window.priorityEndsAt) < now) &&
    windows.every(window => now >= new Date(window.priorityStartsAt))
  );
}

/**
 * Whether a window only opens the general phase rather than restricting
 * anyone: it isn't marked to close, and started once a marked phase had
 * ended. Windows stored before #243 work this way, marking where the general
 * phase starts. One that began before any marked phase ended keeps
 * restricting its whole period.
 * @param window The window.
 * @param windows The tournament's priority windows.
 */
function followsClosingPhase(
  window: PriorityWindow,
  windows: readonly PriorityWindow[],
): boolean {
  return (
    !window.closesWithPriority &&
    windows.some(
      earlier =>
        earlier.closesWithPriority &&
        Date.parse(earlier.priorityEndsAt) <=
          Date.parse(window.priorityStartsAt),
    )
  );
}

/**
 * The regulations whose priority window is open at `now`, ends included --
 * the regulations a participant has to pick at least one of while any is
 * listed -- less, once the marked phases are over (`arePhasesOver()`), the
 * windows that only followed them (`followsClosingPhase()`). Generic so a
 * caller keeps whatever else its regulations carry (the label the entry form
 * and the portal print).
 * @param regulations The tournament's regulations.
 * @param now The moment to check at.
 */
export function activePriorityRegulations<
  T extends Omit<RegulationWindow, 'id'>,
>(regulations: readonly T[], now: Date): Array<T & PriorityWindow> {
  const windows = regulations.filter(hasPriorityWindow);
  const open = openWindows(windows, now);
  return arePhasesOver(windows, now)
    ? open.filter(window => !followsClosingPhase(window, windows))
    : open;
}

/**
 * The regulations a participant may choose at `now`: all of them, except
 * that the ones marked to close go once the marked phases are over
 * (`arePhasesOver()`). The drop can't go by a window having ended alone: a
 * window often gives priority to people who stay eligible after it, such as
 * residents, and may sit on the tournament's only regulation.
 *
 * Generic for the same reason as `activePriorityRegulations()`.
 * @param regulations The tournament's regulations.
 * @param now The moment to check at.
 */
export function selectableRegulations<T extends Omit<RegulationWindow, 'id'>>(
  regulations: readonly T[],
  now: Date,
): T[] {
  if (!arePhasesOver(regulations.filter(hasPriorityWindow), now)) {
    return [...regulations];
  }
  return regulations.filter(
    regulation =>
      !hasPriorityWindow(regulation) || !regulation.closesWithPriority,
  );
}

/**
 * Why a selection of regulations is refused:
 *
 * - `empty`: it chooses nothing.
 * - `not-offered`: it names something not on offer
 *   (`selectableRegulations()`): a phase that is over, or an id the
 *   tournament doesn't have, which is what a regulation staff deleted looks
 *   like from a form left open. Both are a form overtaken by a change, which
 *   reading the regulations again and choosing again fixes.
 * - `needs-priority`: it claims none of the regulations a priority window
 *   requires one of.
 */
export type RegulationSelectionRefusal =
  'empty' | 'not-offered' | 'needs-priority';

/**
 * Determines whether `selectedRegulationIds` may be chosen at `now`, and if
 * not, why.
 *
 * A participant may meet several of a tournament's conditions at once, so a
 * selection is a set rather than a single regulation. The rule itself is
 * unchanged from when it was one: if `activePriorityRegulations()` lists
 * any regulation, the selection has to contain at least one of them — the
 * window says only participants meeting that condition may enter, not that
 * they may claim nothing else. Where it lists none, any set of the
 * tournament's selectable regulations goes (`selectableRegulations()`): no
 * window is open, or the only ones open just followed the marked phases.
 *
 * An empty selection is never allowed: requirements.md asks for at least
 * one condition to be met.
 * @param regulations All regulations defined for the tournament.
 * @param selectedRegulationIds The regulations the participant wants to
 *     select.
 * @param now The current time.
 * @return Why the selection is refused, or null if it may be chosen.
 */
export function regulationSelectionRefusal(
  regulations: RegulationWindow[],
  selectedRegulationIds: readonly string[],
  now: Date,
): RegulationSelectionRefusal | null {
  if (selectedRegulationIds.length === 0) return 'empty';
  // Every selected id has to name a regulation of this tournament that is
  // still on offer. The composite foreign key behind `entry_regulations`
  // would refuse an outsider anyway, but as a constraint violation rather
  // than as the refusal the entry form can explain.
  const selectable = selectableRegulations(regulations, now);
  const allOnOffer = selectedRegulationIds.every(selectedId =>
    selectable.some(regulation => regulation.id === selectedId),
  );
  if (!allOnOffer) return 'not-offered';

  const activePriorityIds = activePriorityRegulations(regulations, now).map(
    regulation => regulation.id,
  );

  if (activePriorityIds.length === 0) return null;
  const claimsPriority = selectedRegulationIds.some(selectedId =>
    activePriorityIds.includes(selectedId),
  );
  return claimsPriority ? null : 'needs-priority';
}
