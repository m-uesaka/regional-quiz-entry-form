import {z} from 'zod';

export const EntryInputSchema = z
  .object({
    name: z.string().min(1),
    furigana: z.string().min(1),
    displayName: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
    passwordConfirm: z.string().min(8),
    regulationId: z.string().uuid(),
    freeText: z.string().optional(),
    customFieldValues: z.record(
      z.string(),
      z.union([z.string(), z.array(z.string())]),
    ),
  })
  .refine(data => data.password === data.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'パスワードが一致しません',
  });
export type EntryInput = z.infer<typeof EntryInputSchema>;

export const EntryStatusSchema = z.enum([
  'pending_verification',
  'confirmed',
  'waitlisted',
  'cancelled',
]);
export type EntryStatus = z.infer<typeof EntryStatusSchema>;

export const EntrySchema = z.object({
  id: z.string().uuid(),
  tournamentId: z.string().uuid(),
  name: z.string(),
  furigana: z.string(),
  displayName: z.string(),
  email: z.string().email(),
  regulationId: z.string().uuid(),
  freeText: z.string().nullable(),
  // Same value union as `EntryInputSchema.customFieldValues` — every stored
  // value originated from that input shape (checkbox/radio/textarea form
  // fields), so `unknown` would be needlessly imprecise here.
  customFieldValues: z.record(
    z.string(),
    z.union([z.string(), z.array(z.string())]),
  ),
  status: EntryStatusSchema,
  waitlistPosition: z.number().int().nullable(),
});
export type Entry = z.infer<typeof EntrySchema>;

// Statuses exposed by the public entry-list endpoint. `pending_verification`
// entries are excluded from that query, so it is intentionally omitted here
// (unlike `EntryStatusSchema`, which covers every internal status).
export const PublicEntryStatusSchema = z.enum([
  'confirmed',
  'waitlisted',
  'cancelled',
]);
export type PublicEntryStatus = z.infer<typeof PublicEntryStatusSchema>;

// Public entry-list response item: intentionally omits every personal field
// (`name` / `furigana` / `email` / `freeText` etc.) present on `EntrySchema`.
export const EntryListItemSchema = z.object({
  displayName: z.string(),
  status: PublicEntryStatusSchema,
  waitlistPosition: z.number().int().nullable(),
});
export type EntryListItem = z.infer<typeof EntryListItemSchema>;
