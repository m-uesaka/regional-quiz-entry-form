import {describe, expect, it} from 'bun:test';
import {
  activePriorityRegulations,
  regulationSelectionRefusal,
  selectableRegulations,
} from '../logic/regulation-eligibility';
import {
  legacyActiveIds,
  legacyDroppedIds,
  legacyGrid,
  legacySelectableIds,
  legacyTurningPoints,
} from './legacy-general-phase';

/**
 * Every non-empty subset of `ids`.
 * @param ids The ids.
 */
function subsets(ids: string[]): string[][] {
  return Array.from({length: 2 ** ids.length - 1}, (_, n) =>
    ids.filter((_, bit) => ((n + 1) >> bit) & 1),
  );
}

/**
 * What the old code said about a selection, from its own two answers.
 * @param selected The selection.
 * @param selectable What it offered.
 * @param active What it required one of.
 */
function legacyRefusal(
  selected: string[],
  selectable: string[],
  active: string[],
): 'not-offered' | 'needs-priority' | null {
  if (!selected.every(id => selectable.includes(id))) return 'not-offered';
  if (active.length === 0) return null;
  return selected.some(id => active.includes(id)) ? null : 'needs-priority';
}

// 0042 records `closes_with_priority` once, for good; the old code answered
// again at every moment. This walks every moment at which the old answer
// could change, so a tournament that behaves the same here behaves the same
// throughout, and every selection a participant could send at each of them.
describe('the explicit setting against the inference it replaces', () => {
  const grid = legacyGrid();

  it('covers a grid large enough to mean something', () => {
    expect(grid.length).toBeGreaterThan(4000);
    expect(
      grid.filter(c => legacyDroppedIds(c.regulations, c.entryPeriod).size > 0)
        .length,
    ).toBeGreaterThan(100);
  });

  it('answers the same at every moment once 0042 has marked what dropped', () => {
    for (const {regulations, entryPeriod} of grid) {
      const dropped = legacyDroppedIds(regulations, entryPeriod);
      const marked = regulations.map(regulation => ({
        ...regulation,
        closesWithPriority: dropped.has(regulation.id),
      }));
      const ids = regulations.map(regulation => regulation.id);
      const selections = subsets(ids);

      for (const now of legacyTurningPoints(regulations, entryPeriod)) {
        const context = JSON.stringify({regulations, now});
        const active = legacyActiveIds(regulations, now, entryPeriod);
        const selectable = legacySelectableIds(regulations, now, entryPeriod);

        expect([
          context,
          activePriorityRegulations(marked, now).map(r => r.id),
        ]).toEqual([context, ids.filter(id => active.includes(id))]);
        expect([
          context,
          selectableRegulations(marked, now).map(r => r.id),
        ]).toEqual([context, selectable]);
        for (const selected of selections) {
          expect([
            context,
            selected,
            regulationSelectionRefusal(marked, selected, now),
          ]).toEqual([
            context,
            selected,
            legacyRefusal(selected, selectable, active),
          ]);
        }
      }
    }
  }, 60_000);
});
