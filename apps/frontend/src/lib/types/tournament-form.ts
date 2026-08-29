/**
 * The controls of the tournament form, as they carry their values.
 *
 * Everything is a string because these are read straight back off the
 * submitted form: `capacity` is blank for "no limit", and the two entry
 * fields hold `datetime-local` values (JST wall-clock times, see
 * `$lib/jst-datetime`) rather than instants.
 */
export interface TournamentFormValues {
  regionId: string;
  type: string;
  name: string;
  capacity: string;
  entryOpensAt: string;
  entryClosesAt: string;
}
