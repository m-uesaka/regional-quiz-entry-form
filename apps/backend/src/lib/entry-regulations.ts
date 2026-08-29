/**
 * Reading an entry's regulation selection out of the `entry_regulations`
 * join table (migration 0018).
 *
 * An entry may claim several of its tournament's regulations, so the staff
 * list, the staff detail screen, the CSV export and mypage all read the
 * same to-many embed — and have to agree on the order they show it in,
 * which PostgREST makes no promise about for an embedded resource.
 */

/**
 * One row of the join, with its regulation embedded. The embed is not
 * nullable: a join row exists only because both of its composite foreign
 * keys resolve, so there is always a regulation behind it.
 */
export interface EntryRegulationRow {
  regulation_id: string;
  regulations: {label: string; display_order: number};
}

/** The `select` fragment that reads the rows above. */
export const ENTRY_REGULATIONS_COLUMNS =
  'entry_regulations(regulation_id, regulations(label, display_order))';

/**
 * Puts an entry's regulations into the order its tournament defines for
 * them, so the same entry reads the same way on every screen.
 * @param rows The embedded join rows, in whatever order they arrived.
 */
export function sortEntryRegulations(
  rows: EntryRegulationRow[],
): EntryRegulationRow[] {
  return [...rows].sort(
    (a, b) => a.regulations.display_order - b.regulations.display_order,
  );
}

/**
 * The labels of an entry's regulations, in the tournament's display order.
 * @param rows The embedded join rows.
 */
export function entryRegulationLabels(rows: EntryRegulationRow[]): string[] {
  return sortEntryRegulations(rows).map(row => row.regulations.label);
}
