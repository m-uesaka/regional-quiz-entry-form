import {z} from 'zod';

export const RegulationSchema = z.object({
  id: z.string().uuid(),
  tournamentId: z.string().uuid(),
  label: z.string(),
  priorityStartsAt: z.string().datetime({offset: true}).nullable(),
  priorityEndsAt: z.string().datetime({offset: true}).nullable(),
  displayOrder: z.number().int(),
});
export type Regulation = z.infer<typeof RegulationSchema>;
