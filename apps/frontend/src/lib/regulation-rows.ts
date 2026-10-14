import {toJstDatetimeLocal} from '$lib/jst-datetime';
import type {RegulationRowValues} from '$lib/types/regulation-form';

/** The parts of a regulation the form shows, stored or freshly imported. */
interface RegulationRowSource {
  id?: string;
  label: string;
  priorityStartsAt: string | null;
  priorityEndsAt: string | null;
}

/**
 * Turns a regulation into the row the controls carry. The priority window is
 * shown as JST wall-clock time, which is what the save action reads back.
 * @param regulation A stored regulation, or one read from a spreadsheet
 *     (which has no `id` unless it was paired with a stored one).
 */
export function toRegulationRow(
  regulation: RegulationRowSource,
): RegulationRowValues {
  return {
    id: regulation.id ?? '',
    // The rendered position fills this in; a row only carries a value of
    // its own after a rejected save, where it echoes what was typed.
    order: '',
    label: regulation.label,
    priorityStartsAt: toJstDatetimeLocal(regulation.priorityStartsAt),
    priorityEndsAt: toJstDatetimeLocal(regulation.priorityEndsAt),
    remove: false,
  };
}

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
export function isUntouchedNewRegulationRow(row: RegulationRowValues): boolean {
  return (
    row.id === '' &&
    row.label.trim() === '' &&
    row.priorityStartsAt === '' &&
    row.priorityEndsAt === ''
  );
}
