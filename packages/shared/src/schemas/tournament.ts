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
export const TournamentCreateInputSchema = TournamentSchema.omit({id: true});
export type TournamentCreateInput = z.infer<typeof TournamentCreateInputSchema>;

// Request body of `PATCH /api/tournaments/:id`. Every field is optional
// because this is a PATCH: an omitted one keeps the tournament's current
// value.
export const TournamentUpdateInputSchema =
  TournamentCreateInputSchema.partial();
export type TournamentUpdateInput = z.infer<typeof TournamentUpdateInputSchema>;

// Japanese display labels for each tournament type, shared so staff-facing
// screens don't each carry their own copy of the wording.
export const TOURNAMENT_TYPE_LABELS: Record<TournamentType, string> = {
  saikyoi: '最強位',
  shinjinou: '新人王',
};
