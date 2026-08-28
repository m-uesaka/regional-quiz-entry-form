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

/**
 * One entry of a regulation save request. An element carrying an `id`
 * updates that existing row; one without adds a new regulation.
 *
 * `displayOrder` is deliberately absent: the array order is the display
 * order, so a client can reorder regulations by reordering the array
 * without having to renumber anything itself.
 */
export const RegulationUpsertSchema = z
  .object({
    id: z.string().uuid().optional(),
    label: z.string().min(1).max(200),
    // Omitting either field means "no priority window", so a client that
    // never uses one doesn't have to send explicit nulls.
    priorityStartsAt: z
      .string()
      .datetime({offset: true})
      .nullable()
      .default(null),
    priorityEndsAt: z
      .string()
      .datetime({offset: true})
      .nullable()
      .default(null),
  })
  .refine(r => (r.priorityStartsAt === null) === (r.priorityEndsAt === null), {
    message: '優先期間は開始と終了の両方を指定してください',
    path: ['priorityEndsAt'],
  })
  .refine(
    r =>
      r.priorityStartsAt === null ||
      Date.parse(r.priorityStartsAt) < Date.parse(r.priorityEndsAt!),
    {
      message: '優先期間の終了は開始より後にしてください',
      path: ['priorityEndsAt'],
    },
  );
export type RegulationUpsert = z.infer<typeof RegulationUpsertSchema>;

/**
 * Request body of the regulation save API: the tournament's regulations in
 * full, as the whole set should look afterwards.
 *
 * At least one regulation is required — an entry has to name one, so a
 * tournament with none can't be entered at all.
 */
export const RegulationSyncInputSchema = z.object({
  regulations: z
    .array(RegulationUpsertSchema)
    .min(1)
    // Two elements naming the same existing row would make the sync
    // ambiguous (and the upsert behind it fails outright when a single
    // statement touches one row twice), so they're rejected here instead.
    .refine(
      regulations => {
        const ids = regulations
          .map(r => r.id)
          .filter((id): id is string => id !== undefined);
        return new Set(ids).size === ids.length;
      },
      {message: 'レギュレーションの id が重複しています'},
    ),
});
export type RegulationSyncInput = z.infer<typeof RegulationSyncInputSchema>;
