import {
  TournamentCreateInputSchema,
  type Tournament,
  type TournamentCreateInput,
} from '@regional-quiz/shared';
import {fromJstDatetimeLocal, toJstDatetimeLocal} from '$lib/jst-datetime';
import type {TournamentFormValues} from '$lib/types/tournament-form';
import {readString} from '$lib/form-data';
import {INVALID_INPUT_MESSAGE} from '$lib/form-errors';

/**
 * What the edit screen's participant-data reset asks to be typed before its
 * button does anything, checked again by its form action. A tick, as the
 * delete section asks for, is one click away from a stray one; wiping every
 * entry deserves a deliberate keystroke.
 */
export const RESET_CONFIRMATION_WORD = 'リセット';

/**
 * Whether what was typed into the reset confirmation is the word. Compared
 * after NFKC normalization and trimming, so the half-width ﾘｾｯﾄ or a
 * trailing full-width space an IME leaves behind still counts.
 * @param value The submitted `confirmation` field.
 */
export function isResetConfirmation(value: FormDataEntryValue | null): boolean {
  return (
    typeof value === 'string' &&
    value.normalize('NFKC').trim() === RESET_CONFIRMATION_WORD
  );
}

/** A form with nothing filled in, which is how a tournament is created. */
export function emptyTournamentFormValues(): TournamentFormValues {
  return {
    regionId: '',
    type: 'saikyoi',
    name: '',
    capacity: '',
    entryOpensAt: '',
    entryClosesAt: '',
    questionSet: '',
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
    // A blank control is the common questions the API stores as null.
    questionSet: tournament.questionSet ?? '',
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
    questionSet: readString(formData, 'questionSet'),
  };
}

/** What `parseTournamentFormValues()` makes of a submitted form. */
export type TournamentFormParse =
  | {readonly ok: true; readonly input: TournamentCreateInput}
  | {readonly ok: false; readonly error: string};

/**
 * Checks a submitted form against the same schema the API validates with,
 * turning the control values into the body it takes.
 *
 * @param values What the controls carried.
 * @return The request body, or why the form is not one the API would accept,
 *     in words to show above the form. Most of the schema's messages name
 *     the field in English, which is no use on this screen, so a refusal of
 *     those is reported as `INVALID_INPUT_MESSAGE` — those controls are a
 *     select the page fills in, marked `required`, or free to leave blank
 *     (大会名), so a rejection of them means the browser's own checks were
 *     bypassed rather than that a staff member mistyped something. What
 *     staff can get wrong by typing — the 問題セット (a space inside it, a
 *     name too long) and an entry period that doesn't open before it closes
 *     (#285), which the browser doesn't check across two controls — the
 *     schema refuses with refinements worded in Japanese for this form, and
 *     those are shown as they are, all of them at once.
 */
export function parseTournamentFormValues(
  values: TournamentFormValues,
): TournamentFormParse {
  const body = {
    regionId: values.regionId,
    type: values.type,
    name: values.name,
    capacity: values.capacity.trim() === '' ? null : Number(values.capacity),
    entryOpensAt: fromJstDatetimeLocal(values.entryOpensAt),
    entryClosesAt: fromJstDatetimeLocal(values.entryClosesAt),
    questionSet: values.questionSet,
  };
  const parsed = TournamentCreateInputSchema.safeParse(body);
  if (parsed.success) {
    return {ok: true, input: parsed.data};
  }
  const messages = new Set(refinementMessages(parsed.error));
  // A refused 問題セット fails the transform it sits in, which makes Zod
  // skip the object's own refinement -- the entry period's. So the form is
  // checked once more with the 問題セット left blank, which is always
  // accepted, to name a bad period along with it.
  if (parsed.error.issues.some(issue => issue.path[0] === 'questionSet')) {
    const rest = TournamentCreateInputSchema.safeParse({
      ...body,
      questionSet: '',
    });
    if (!rest.success) {
      for (const message of refinementMessages(rest.error)) {
        messages.add(message);
      }
    }
  }
  return {
    ok: false,
    error:
      messages.size === 0 ? INVALID_INPUT_MESSAGE : [...messages].join('。'),
  };
}

/**
 * The part of a `ZodError` `refinementMessages()` reads, typed structurally
 * as `$lib/zod-field-errors` does, so the frontend needn't depend on `zod`.
 */
interface IssuesError {
  readonly issues: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
  }>;
}

/**
 * The messages of the schema's refinements among `error`'s issues: the only
 * issues it raises as `custom`, and the ones worded for this form.
 * @param error What the schema refused the form with.
 */
function refinementMessages(error: IssuesError): string[] {
  return error.issues
    .filter(issue => issue.code === 'custom')
    .map(issue => issue.message);
}
