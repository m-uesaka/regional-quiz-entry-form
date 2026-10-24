import {
  TournamentCreateInputSchema,
  type Tournament,
  type TournamentCreateInput,
} from '@regional-quiz/shared';
import {fromJstDatetimeLocal, toJstDatetimeLocal} from '$lib/jst-datetime';
import type {TournamentFormValues} from '$lib/types/tournament-form';

/** A form with nothing filled in, which is how a tournament is created. */
export function emptyTournamentFormValues(): TournamentFormValues {
  return {
    regionId: '',
    type: 'saikyoi',
    name: '',
    capacity: '',
    entryOpensAt: '',
    entryClosesAt: '',
  };
}

/**
 * Shows a stored tournament as the values its controls carry. The entry
 * window is shown as JST wall-clock time, which is what the action reads
 * back.
 * @param tournament The tournament being edited.
 * @param customName The 大会名 staff typed, or null when it was left blank.
 *     A blank one stays blank here rather than showing the default name
 *     `tournament.name` carries: sent back, that would pin the name to the
 *     current region and type, and a corrected region would keep the old
 *     region's name.
 */
export function toTournamentFormValues(
  tournament: Tournament,
  customName: string | null,
): TournamentFormValues {
  return {
    regionId: tournament.regionId,
    type: tournament.type,
    name: customName ?? '',
    // A blank control is the "no limit" the API takes as null.
    capacity: tournament.capacity === null ? '' : String(tournament.capacity),
    entryOpensAt: toJstDatetimeLocal(tournament.entryOpensAt),
    entryClosesAt: toJstDatetimeLocal(tournament.entryClosesAt),
  };
}

/**
 * Reads the tournament form off a submitted body.
 * @param formData The submitted body.
 */
export function readTournamentFormValues(
  formData: FormData,
): TournamentFormValues {
  return {
    regionId: readString(formData, 'regionId'),
    type: readString(formData, 'type'),
    name: readString(formData, 'name'),
    capacity: readString(formData, 'capacity'),
    entryOpensAt: readString(formData, 'entryOpensAt'),
    entryClosesAt: readString(formData, 'entryClosesAt'),
  };
}

/**
 * Checks a submitted form against the same schema the API validates with,
 * turning the control values into the body it takes.
 *
 * @param values What the controls carried.
 * @return The request body, or null when the form is not one the API would
 *     accept. The schema's own messages name the field in English, which is
 *     no use on this screen, so the caller reports a written-out refusal
 *     instead — every control here is either a select the page fills in,
 *     marked `required`, or free to leave blank (大会名), so a rejection
 *     means the browser's own checks were bypassed rather than that a staff
 *     member mistyped something.
 */
export function parseTournamentFormValues(
  values: TournamentFormValues,
): TournamentCreateInput | null {
  const parsed = TournamentCreateInputSchema.safeParse({
    regionId: values.regionId,
    type: values.type,
    name: values.name,
    capacity: values.capacity.trim() === '' ? null : Number(values.capacity),
    entryOpensAt: fromJstDatetimeLocal(values.entryOpensAt),
    entryClosesAt: fromJstDatetimeLocal(values.entryClosesAt),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Reads one text control, which `FormData` types as possibly a file.
 * @param formData The submitted body.
 * @param name The control's name.
 */
function readString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}
