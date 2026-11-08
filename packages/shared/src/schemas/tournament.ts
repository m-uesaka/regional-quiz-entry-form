import {z} from 'zod';

export const TournamentTypeSchema = z.enum(['saikyoi', 'shinjinou']);
export type TournamentType = z.infer<typeof TournamentTypeSchema>;

// The longest question set name `tournaments_question_set_format` (0043)
// accepts, in code points as its `char_length` counts them.
export const QUESTION_SET_MAX_LENGTH = 100;

// What 問題セット takes in the admin form (0043). A name differing by a
// single character counts as another question set, which lets through the
// cross-region entries it should refuse, so the differences nobody sees are
// taken out before it is stored, the same way 0044 made the database store
// them: format characters (a zero-width space pasted along with a name) are
// dropped, NFKC folds full-width letters and digits into the ones staff type
// elsewhere, and the ends are trimmed (full-width spaces included). A space
// left inside is refused, as the database refuses it. Blank means the
// common questions, stored as null.
//
// What this stores is already in that form, so sending a stored name back
// unchanged -- as the edit form does on every save -- stores it unchanged.
export const QuestionSetInputSchema = z
  .string()
  .transform(value =>
    value
      .replace(/\p{Cf}/gu, '')
      .normalize('NFKC')
      .trim(),
  )
  .pipe(
    z
      .string()
      // Code points, not the UTF-16 units `.max()` counts: a kanji outside
      // the BMP (𠮷) is one character to the database.
      .refine(value => [...value].length <= QUESTION_SET_MAX_LENGTH, {
        message: `問題セットは${QUESTION_SET_MAX_LENGTH}文字以内で入力してください`,
      })
      .refine(value => !/\s/.test(value), {
        message: '問題セットに空白は使えません',
      }),
  )
  .transform(value => (value === '' ? null : value))
  .nullable();

// Response body of `GET /api/tournaments/question-sets`: the names
// tournaments use, distinct and sorted.
export const QuestionSetListSchema = z.array(z.string());
export type QuestionSetList = z.infer<typeof QuestionSetListSchema>;

export const TournamentSchema = z.object({
  id: z.string().uuid(),
  regionId: z.string().uuid(),
  type: TournamentTypeSchema,
  name: z.string(),
  capacity: z.number().int().positive().nullable(),
  entryOpensAt: z.string().datetime({offset: true}),
  entryClosesAt: z.string().datetime({offset: true}),
  // Staff paused taking entries (0039): within the period or not, no new
  // entry is accepted and the form is staff-only, as outside the period.
  entriesPaused: z.boolean(),
  // The question set the tournament uses (0043), or null for the common
  // questions of its type. Two tournaments of different regions can't both
  // be entered when this is the same name, or null for both and the same
  // type (0046): 最強位 and 新人王 don't share their common questions.
  questionSet: z.string().nullable(),
});
export type Tournament = z.infer<typeof TournamentSchema>;

// Request body of `POST /api/tournaments`: everything but the id, which the
// database assigns. Shared so the admin form's own check and the API's
// `zValidator` are the same rule rather than two that can drift apart.
//
// `name` may be left out or blank: the usual name is just the region's
// name followed by the type's label, so the API stores no name and answers
// with `defaultTournamentName()` for the region and type at the time of each
// read, rather than making staff type it.
export const TournamentCreateInputSchema = TournamentSchema.omit({
  id: true,
  // Switched by staff on its own (`TournamentEntryPauseInputSchema`), not
  // with the rest of the tournament's settings.
  entriesPaused: true,
}).extend({
  name: z.string().trim().default(''),
  questionSet: QuestionSetInputSchema.default(null),
});
export type TournamentCreateInput = z.infer<typeof TournamentCreateInputSchema>;

// Request body of `PATCH /api/tournaments/:id`. Every field is optional
// because this is a PATCH: an omitted one keeps the tournament's current
// value. A blank `name` is not "keep": it clears the name, so the tournament
// goes back to `defaultTournamentName()` for whatever region and type it
// has.
export const TournamentUpdateInputSchema =
  TournamentCreateInputSchema.partial();
export type TournamentUpdateInput = z.infer<typeof TournamentUpdateInputSchema>;

// Request body of `PUT /api/tournaments/order`: every tournament's id, in
// the order general staff want them shown. The API refuses a list that
// isn't exactly the tournaments there are, so a tournament created or
// deleted since the screen was opened isn't placed by guesswork.
export const TournamentOrderInputSchema = z.object({
  tournamentIds: z
    .array(z.string().uuid({message: '大会の id が正しくありません'}))
    .min(1, {message: '並べ替える大会がありません'})
    .refine(ids => new Set(ids).size === ids.length, {
      message: '大会の id が重複しています',
    }),
});
export type TournamentOrderInput = z.infer<typeof TournamentOrderInputSchema>;

// Request body of `PUT /api/staff/tournaments/:tournamentId/entry-pause`:
// whether the tournament should stop (true) or resume (false) taking
// entries. A PUT of the state rather than a toggle, so a double submit
// leaves it where the staff member meant.
export const TournamentEntryPauseInputSchema = z.object({
  paused: z.boolean(),
});
export type TournamentEntryPauseInput = z.infer<
  typeof TournamentEntryPauseInputSchema
>;

// Request body of `POST /api/tournaments/:id/reset`, which deletes every
// entry of the tournament. `deleteParticipants` is required rather than
// defaulted, so whether the accounts go too is always a choice someone made:
// true also deletes the accounts of those entries' participants, except
// those still entered in another tournament.
export const TournamentResetInputSchema = z.object({
  deleteParticipants: z.boolean(),
});
export type TournamentResetInput = z.infer<typeof TournamentResetInputSchema>;

// Response body of `POST /api/tournaments/:id/reset`. `keptParticipantCount`
// is the accounts left in place because they still have an entry in another
// tournament; always 0 when `deleteParticipants` was false.
export const TournamentResetResponseSchema = z.object({
  deletedEntryCount: z.number().int().nonnegative(),
  deletedParticipantCount: z.number().int().nonnegative(),
  keptParticipantCount: z.number().int().nonnegative(),
});
export type TournamentResetResponse = z.infer<
  typeof TournamentResetResponseSchema
>;

// What promoting the waitlist into free seats came to (#223): how many
// waitlisted entries were confirmed, and how many of their participants the
// promotion mail could not reach -- those have to be told some other way.
export const WaitlistPromotionSchema = z.object({
  promotedCount: z.number().int().nonnegative(),
  mailFailedCount: z.number().int().nonnegative(),
});
export type WaitlistPromotion = z.infer<typeof WaitlistPromotionSchema>;

// Response body of `PATCH /api/tournaments/:id`: the updated tournament,
// and -- when a capacity was sent -- what promoting the waitlist into the
// seats it freed came to. `promotion` is null when that promotion failed
// (the update itself is saved), and `{0, 0}` when it didn't run or found
// nobody to promote.
export const TournamentUpdateResponseSchema = TournamentSchema.extend({
  promotion: WaitlistPromotionSchema.nullable(),
});
export type TournamentUpdateResponse = z.infer<
  typeof TournamentUpdateResponseSchema
>;

// What `PATCH /api/tournaments/:id` answers (409) when it would move a
// tournament that has entries to another region or type (#284): the entries
// would follow without the dual-entry checks they were accepted under, so
// the database refuses it (`tournaments_lock_region_type_with_entries`,
// 0049). Shown as it is above the admin form. Deleting the entries with the
// participant data reset lifts it.
export const TOURNAMENT_REGION_TYPE_LOCKED_MESSAGE =
  'エントリーがある大会の地域・種別は変更できません。変更するには、先に参加者データをリセットしてください';

// Japanese display labels for each tournament type, shared so staff-facing
// screens don't each carry their own copy of the wording.
export const TOURNAMENT_TYPE_LABELS: Record<TournamentType, string> = {
  saikyoi: '最強位',
  shinjinou: '新人王',
};

/**
 * The name a tournament gets when staff leave 大会名 blank: the region's
 * name followed by the type's label, e.g. 「東京最強位」.
 * @param regionName The name of the region the tournament is held in.
 * @param type The tournament's type.
 */
export function defaultTournamentName(
  regionName: string,
  type: TournamentType,
): string {
  return `${regionName}${TOURNAMENT_TYPE_LABELS[type]}`;
}
