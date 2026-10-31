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
 * Whether a window runs to the close of entries, give or take how sheets
 * spell it (`CLOSE_TOLERANCE_MS`).
 * @param window The window.
 * @param entryPeriod The tournament's entry period.
 */
function reachesClose(
  window: PriorityWindow,
  entryPeriod: EntryPeriod,
): boolean {
  return (
    Date.parse(window.priorityEndsAt) >=
    Date.parse(entryPeriod.entryClosesAt) - CLOSE_TOLERANCE_MS
  );
}

/**
 * Whether a window is an earlier phase that is over: it ended after entries
 * opened, so it let someone in, and before the close, so a phase came after
 * it. One over before entries opened let nobody in, so it is left over
 * rather than a phase; 千葉 and 新潟 keep theirs on a regulation that stays
 * in use.
 * @param window The window.
 * @param now The moment to check at.
 * @param entryPeriod The tournament's entry period.
 */
function isFinishedPhase(
  window: PriorityWindow,
  now: Date,
  entryPeriod: EntryPeriod,
): boolean {
  const endsAt = Date.parse(window.priorityEndsAt);
  return (
    endsAt > Date.parse(entryPeriod.entryOpensAt) &&
    endsAt < now.getTime() &&
    !reachesClose(window, entryPeriod)
  );
}

/**
 * Whether a tournament is in its last, general phase rather than a priority
 * one (#235): staff phase a tournament by giving the general regulation a
 * window from the end of the priority one up to the close.
 *
 * All of these have to hold, each ruling out a window that really restricts
 * who may enter:
 *
 * - No window is still to start: a later phase's regulation has to wait for
 *   it, and lifting the check now would only bring it back when that opens.
 * - A window is open and every open one runs to the close: one ending
 *   earlier leaves entries to come after it, so it gives priority over those.
 *   One running to the close counts as open up to the close itself, however
 *   its end is spelt, so the phase doesn't lapse just before the deadline.
 * - Each of them started once an earlier phase was over
 *   (`isFinishedPhase()`): one alongside a window, or with none before it,
 *   restricts the whole of its own period.
 * @param windows The tournament's priority windows.
 * @param now The moment to check at.
 * @param entryPeriod The tournament's entry period.
 */
function isGeneralPhase(
  windows: readonly PriorityWindow[],
  now: Date,
  entryPeriod: EntryPeriod,
): boolean {
  if (windows.some(window => now < new Date(window.priorityStartsAt))) {
    return false;
  }
  const active = windows.filter(
    window =>
      now >= new Date(window.priorityStartsAt) &&
      (now <= new Date(window.priorityEndsAt) ||
        reachesClose(window, entryPeriod)),
  );
  const phaseEnds = windows
    .filter(window => isFinishedPhase(window, now, entryPeriod))
    .map(window => Date.parse(window.priorityEndsAt));
  return (
    active.length > 0 &&
    active.every(
      window =>
        reachesClose(window, entryPeriod) &&
        phaseEnds.some(endsAt => endsAt <= Date.parse(window.priorityStartsAt)),
    )
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
  return isGeneralPhase(windows, now, entryPeriod)
    ? []
    : openWindows(windows, now);
}

/**
 * The regulations a participant may choose at `now`: all of them, except
 * that a tournament's general phase (`isGeneralPhase()`) drops the earlier
 * phases, whose priority is over. The drop can't go by a window having ended
 * alone: a window often gives priority to people who stay eligible after it,
 * such as residents, and may sit on the tournament's only regulation.
 *
 * Generic for the same reason as `activePriorityRegulations()`.
 * @param regulations The tournament's regulations.
 * @param now The moment to check at.
 * @param entryPeriod The tournament's entry period.
 */
export function selectableRegulations<T extends Omit<RegulationWindow, 'id'>>(
  regulations: readonly T[],
  now: Date,
  entryPeriod: EntryPeriod,
): T[] {
  if (
    !isGeneralPhase(regulations.filter(hasPriorityWindow), now, entryPeriod)
  ) {
    return [...regulations];
  }
  return regulations.filter(
    regulation =>
      !hasPriorityWindow(regulation) ||
      !isFinishedPhase(regulation, now, entryPeriod),
  );
}

/**
 * Why a selection of regulations is refused:
 *
 * - `empty`: it chooses nothing.
 * - `unknown`: it names an id that isn't one of the tournament's regulations.
 * - `not-offered`: it names a regulation of the tournament that is no longer
 *   on offer (`selectableRegulations()`). Takes precedence over `unknown`
 *   when both apply: only this one is a form overtaken by a change, which
 *   choosing again fixes, whatever else the submission names.
 * - `needs-priority`: it claims none of the regulations a priority window
 *   requires one of.
 */
export type RegulationSelectionRefusal =
  'empty' | 'unknown' | 'not-offered' | 'needs-priority';

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
 * window is open, or the tournament is in its general phase, where one is
 * open but no longer restricts anyone.
 *
 * An empty selection is never allowed: requirements.md asks for at least
 * one condition to be met.
 * @param regulations All regulations defined for the tournament.
 * @param selectedRegulationIds The regulations the participant wants to
 *     select.
 * @param now The current time.
 * @param entryPeriod The tournament's entry period.
 * @return Why the selection is refused, or null if it may be chosen.
 */
export function regulationSelectionRefusal(
  regulations: RegulationWindow[],
  selectedRegulationIds: readonly string[],
  now: Date,
  entryPeriod: EntryPeriod,
): RegulationSelectionRefusal | null {
  if (selectedRegulationIds.length === 0) return 'empty';
  // Every selected id has to name a regulation of this tournament that is
  // still on offer. The composite foreign key behind `entry_regulations`
  // would refuse an outsider anyway, but as a constraint violation rather
  // than as the refusal the entry form can explain.
  const selectable = selectableRegulations(regulations, now, entryPeriod);
  const notOnOffer = selectedRegulationIds.filter(
    selectedId => !selectable.some(regulation => regulation.id === selectedId),
  );
  const anyPhasedOut = notOnOffer.some(selectedId =>
    regulations.some(regulation => regulation.id === selectedId),
  );
  if (anyPhasedOut) return 'not-offered';
  if (notOnOffer.length > 0) return 'unknown';

  const activePriorityIds = activePriorityRegulations(
    regulations,
    now,
    entryPeriod,
  ).map(regulation => regulation.id);

  if (activePriorityIds.length === 0) return null;
  const claimsPriority = selectedRegulationIds.some(selectedId =>
    activePriorityIds.includes(selectedId),
  );
  return claimsPriority ? null : 'needs-priority';
}
