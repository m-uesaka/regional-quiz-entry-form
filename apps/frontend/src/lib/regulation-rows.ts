import type {RegulationRowValues} from '$lib/types/regulation-form';

/** A row of the regulation form with nothing filled in. */
export function emptyRegulationRow(): RegulationRowValues {
  return {
    id: '',
    order: '',
    label: '',
    priorityStartsAt: '',
    priorityEndsAt: '',
    remove: false,
  };
}

/**
 * Whether this is one of the blank rows the page renders under the saved ones
 * and nobody filled in. Only a row that has never been saved can be dropped
 * this way — an existing regulation whose label was cleared is a mistake the
 * schema should report, not a row to silently discard.
 *
 * "表示順" is deliberately not looked at: a number on its own names no
 * regulation, so a row carrying only that is still one to drop.
 *
 * @param row The row to judge.
 */
export function isUntouchedNewRegulationRow(
  row: RegulationRowValues,
): boolean {
  return (
    row.id === '' &&
    row.label.trim() === '' &&
    row.priorityStartsAt === '' &&
    row.priorityEndsAt === ''
  );
}
