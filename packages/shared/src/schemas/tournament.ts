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

// Japanese display labels for each tournament type, shared so staff-facing
// screens don't each carry their own copy of the wording.
export const TOURNAMENT_TYPE_LABELS: Record<TournamentType, string> = {
  saikyoi: '最強位',
  shinjinou: '新人王',
};
