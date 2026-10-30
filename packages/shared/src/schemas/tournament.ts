import {z} from 'zod';

export const TournamentTypeSchema = z.enum(['saikyoi', 'shinjinou']);
export type TournamentType = z.infer<typeof TournamentTypeSchema>;

export const TournamentSchema = z.object({
  id: z.string().uuid(),
  regionId: z.string().uuid(),
  type: TournamentTypeSchema,
  name: z.string(),
  capacity: z.number().int().positive().nullable(),
  entryOpensAt: z.string().datetime({offset: true}),
  entryClosesAt: z.string().datetime({offset: true}),
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
}).extend({name: z.string().trim().default('')});
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
