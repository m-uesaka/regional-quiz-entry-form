/** One row of a form that is reordered by typing a "表示順" into each row. */
export interface SubmittedOrderRow<T> {
  /** The row's 0-based position in the form as it was rendered. */
  index: number;
  /** What was submitted in the row's "表示順" control. */
  order: string;
  value: T;
}

/**
 * Puts the rows of a submitted form in the order their "表示順" asks for.
 *
 * The page pre-fills each "表示順" with the row's current 1-based position,
 * so a form nobody reordered comes back in the order it was rendered in,
 * and moving a row is a matter of rewriting its number. Only the relative
 * order matters, so gaps in the numbers (or in the indices) are fine.
 *
 * Ties are broken by which way the number was rewritten, so a row lands at
 * exactly the position typed into it: a row moved up goes ahead of the row
 * left at that position, and a row moved down goes behind it. Rows left
 * where they were close up around it in the order they were displayed.
 * Without that, typing `1` into the third of three rows -- the one gesture
 * the pages tell staff to use -- would leave it behind the row already
 * numbered `1`, and typing `3` into the first would leave it ahead of the
 * row already numbered `3`.
 *
 * @param rows The submitted rows, in any order.
 * @return The rows' values, in the order they should be saved in.
 */
export function sortBySubmittedOrder<T>(
  rows: ReadonlyArray<SubmittedOrderRow<T>>,
): T[] {
  return [...rows]
    .sort(
      (left, right) =>
        rowPosition(left) - rowPosition(right) ||
        moveRank(left) - moveRank(right) ||
        left.index - right.index,
    )
    .map(row => row.value);
}

/**
 * Puts items in the order a failed save submitted their ids in, so the
 * screen can show the order that was being saved instead of the stored one.
 *
 * The submitted ids come from the request, so they are not trusted to
 * match the items: an id no item has is skipped, an id given twice counts
 * where it first appears, and the items whose id was not submitted follow
 * the submitted ones, in the order they are stored in.
 *
 * @param items The items, in the order they are stored in.
 * @param ids The submitted ids, or null to keep the stored order.
 * @return The items, in the submitted order.
 */
export function arrangeBySubmittedIds<T extends {id: string}>(
  items: readonly T[],
  ids: readonly string[] | null | undefined,
): T[] {
  if (!ids) return [...items];
  const unplaced = new Map(items.map(item => [item.id, item]));
  const arranged: T[] = [];
  for (const id of ids) {
    const item = unplaced.get(id);
    if (!item) continue;
    arranged.push(item);
    unplaced.delete(id);
  }
  // A Map iterates in insertion order, so these stay in the stored order.
  return [...arranged, ...unplaced.values()];
}

/**
 * How a row ranks among others claiming the same position: one moved up
 * first, then the one still carrying the number the page pre-filled it
 * with, then one moved down.
 * @param row The submitted row.
 * @return -1 for a row moved up, 0 for one left alone, 1 for one moved
 *     down.
 */
function moveRank(row: SubmittedOrderRow<unknown>): number {
  return Math.sign(rowPosition(row) - (row.index + 1));
}

/**
 * Where a row asked to be placed, on the 1-based scale the control shows.
 * @param row The submitted row.
 * @return The requested position, or the row's own position when the
 *     control was left empty or holds something that isn't a number.
 */
function rowPosition(row: SubmittedOrderRow<unknown>): number {
  if (row.order.trim() === '') return row.index + 1;
  const requested = Number(row.order);
  return Number.isFinite(requested) ? requested : row.index + 1;
}
