/**
 * One row of the regulation management form, as the controls carry it.
 *
 * Everything is a string because these are read straight back off the
 * submitted form: `id` is empty for a row that has not been saved yet, and
 * the two priority fields hold `datetime-local` values (JST wall-clock
 * times, see `$lib/jst-datetime`) rather than instants.
 */
export interface RegulationRowValues {
  id: string;
  /**
   * The "表示順" control: what the staff member wants this row's position to
   * be. Blank means "leave it where it is", so a set nobody has reordered
   * still saves in the order it was rendered in.
   */
  order: string;
  label: string;
  priorityStartsAt: string;
  priorityEndsAt: string;
  /** Whether the row's "削除" box was ticked, i.e. drop it from the save. */
  remove: boolean;
}
