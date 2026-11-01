/**
 * Test-only: the phase inference `regulation-eligibility.ts` had before #243,
 * kept verbatim as the oracle for migration 0042. What 0042 has to preserve
 * is what this did, so the tests compare against it rather than against
 * expectations derived from the new code. Don't "fix" it, and don't import it
 * from anything that ships.
 */

/** A regulation as the old inference read it. */
export interface LegacyRegulation {
  id: string;
  priorityStartsAt: string | null;
  priorityEndsAt: string | null;
}

/** A tournament's entry period. */
export interface LegacyEntryPeriod {
  entryOpensAt: string;
  entryClosesAt: string;
}

type Window = LegacyRegulation & {
  priorityStartsAt: string;
  priorityEndsAt: string;
};

const CLOSE_TOLERANCE_MS = 60_000;

function hasPriorityWindow(regulation: LegacyRegulation): regulation is Window {
  return (
    regulation.priorityStartsAt !== null && regulation.priorityEndsAt !== null
  );
}

function reachesClose(window: Window, entryPeriod: LegacyEntryPeriod): boolean {
  return (
    Date.parse(window.priorityEndsAt) >=
    Date.parse(entryPeriod.entryClosesAt) - CLOSE_TOLERANCE_MS
  );
}

function isFinishedPhase(
  window: Window,
  now: Date,
  entryPeriod: LegacyEntryPeriod,
): boolean {
  const endsAt = Date.parse(window.priorityEndsAt);
  return (
    endsAt > Date.parse(entryPeriod.entryOpensAt) &&
    endsAt < now.getTime() &&
    !reachesClose(window, entryPeriod)
  );
}

function isGeneralPhase(
  windows: readonly Window[],
  now: Date,
  entryPeriod: LegacyEntryPeriod,
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
 * What `activePriorityRegulations()` answered.
 * @param regulations The tournament's regulations.
 * @param now The moment to check at.
 * @param entryPeriod The tournament's entry period.
 */
export function legacyActiveIds(
  regulations: readonly LegacyRegulation[],
  now: Date,
  entryPeriod: LegacyEntryPeriod,
): string[] {
  const windows = regulations.filter(hasPriorityWindow);
  if (isGeneralPhase(windows, now, entryPeriod)) return [];
  return windows
    .filter(
      window =>
        now >= new Date(window.priorityStartsAt) &&
        now <= new Date(window.priorityEndsAt),
    )
    .map(window => window.id);
}

/**
 * What `selectableRegulations()` answered.
 * @param regulations The tournament's regulations.
 * @param now The moment to check at.
 * @param entryPeriod The tournament's entry period.
 */
export function legacySelectableIds(
  regulations: readonly LegacyRegulation[],
  now: Date,
  entryPeriod: LegacyEntryPeriod,
): string[] {
  const windows = regulations.filter(hasPriorityWindow);
  if (!isGeneralPhase(windows, now, entryPeriod)) {
    return regulations.map(regulation => regulation.id);
  }
  return regulations
    .filter(
      regulation =>
        !hasPriorityWindow(regulation) ||
        !isFinishedPhase(regulation, now, entryPeriod),
    )
    .map(regulation => regulation.id);
}

/**
 * Every moment the old answers could change at: each instant of a tournament,
 * a millisecond either side of it.
 * @param regulations The tournament's regulations.
 * @param entryPeriod The tournament's entry period.
 */
export function legacyTurningPoints(
  regulations: readonly LegacyRegulation[],
  entryPeriod: LegacyEntryPeriod,
): Date[] {
  const instants = [
    entryPeriod.entryOpensAt,
    entryPeriod.entryClosesAt,
    ...regulations.flatMap(r => [r.priorityStartsAt, r.priorityEndsAt]),
  ].flatMap(instant => (instant === null ? [] : [Date.parse(instant)]));
  const moments = new Set(instants.flatMap(ms => [ms - 1, ms, ms + 1]));
  return [...moments].sort((a, b) => a - b).map(ms => new Date(ms));
}

/**
 * The regulations 0042 has to mark: the ones the old inference really took
 * off the choices at some moment. Worked out by asking it at every turning
 * point, so it owes nothing to the reasoning behind the SQL it checks.
 * @param regulations The tournament's regulations.
 * @param entryPeriod The tournament's entry period.
 */
export function legacyDroppedIds(
  regulations: readonly LegacyRegulation[],
  entryPeriod: LegacyEntryPeriod,
): Set<string> {
  const dropped = new Set<string>();
  for (const now of legacyTurningPoints(regulations, entryPeriod)) {
    const selectable = legacySelectableIds(regulations, now, entryPeriod);
    for (const {id} of regulations) {
      if (!selectable.includes(id)) dropped.add(id);
    }
  }
  return dropped;
}

/** One tournament of the grid `legacyGrid()` walks. */
export interface LegacyGridCase {
  regulations: LegacyRegulation[];
  entryPeriod: LegacyEntryPeriod;
}

const GRID_PERIOD: LegacyEntryPeriod = {
  entryOpensAt: '2026-11-04T12:00:00.000Z',
  entryClosesAt: '2026-12-25T15:00:00.000Z',
};

// Each instant the old conditions distinguish: before the open, the open
// itself, two moments between, either side of the 60-second tolerance, the
// close and after it.
const GRID_INSTANTS = [
  '2026-11-01T00:00:00.000Z',
  GRID_PERIOD.entryOpensAt,
  '2026-11-10T00:00:00.000Z',
  '2026-11-20T00:00:00.000Z',
  '2026-12-25T14:58:59.000Z',
  '2026-12-25T14:59:00.000Z',
  GRID_PERIOD.entryClosesAt,
  '2026-12-26T00:00:00.000Z',
];

/**
 * Every tournament of three regulations that can be made from the grid's
 * instants, each regulation having a window or none. The order of the
 * regulations means nothing to the rules, so each set appears once.
 */
export function legacyGrid(): LegacyGridCase[] {
  const windows: Array<[string | null, string | null]> = [[null, null]];
  GRID_INSTANTS.forEach((startsAt, i) => {
    for (const endsAt of GRID_INSTANTS.slice(i + 1)) {
      windows.push([startsAt, endsAt]);
    }
  });
  const cases: LegacyGridCase[] = [];
  windows.forEach((a, i) => {
    windows.slice(i).forEach((b, j) => {
      for (const c of windows.slice(i + j)) {
        cases.push({
          entryPeriod: GRID_PERIOD,
          regulations: [a, b, c].map(
            ([priorityStartsAt, priorityEndsAt], n) => ({
              id: `reg-${n}`,
              priorityStartsAt,
              priorityEndsAt,
            }),
          ),
        });
      }
    });
  });
  return cases;
}
