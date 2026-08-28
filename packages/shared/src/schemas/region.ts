import {z} from 'zod';

// A region slug is used verbatim as one segment of the public entry form URL
// (`/{regionSlug}/{tournamentSlug}/entry`), so characters that mean something
// in a path or query string — and uppercase, which would make the URL
// case-sensitive to type — are rejected. The first character is pinned to a
// letter so a slug can never be mistaken for a UUID or a numeric id. The
// message spells the length out because the pattern also caps it (a leading
// letter plus 1-30 more characters, so 2-31 in total) and a rejected slug
// otherwise gives no hint about which of the two rules it broke.
export const RegionSlugSchema = z.string().regex(/^[a-z][a-z0-9-]{1,30}$/, {
  message:
    'slug は英小文字で始まり、英小文字・数字・ハイフンのみで、2〜31 文字にしてください',
});

export const RegionSchema = z.object({
  id: z.string().uuid(),
  slug: RegionSlugSchema,
  name: z.string().min(1).max(100),
  // Whether a participant may hold an entry in both of the region's
  // tournaments at once. requirements.md says only that regions where both
  // are allowed *exist*, so this is a per-region setting rather than a
  // global rule; `createEntry()` is what enforces it.
  allowsDualEntry: z.boolean(),
});
export type Region = z.infer<typeof RegionSchema>;

// `allowsDualEntry` defaults to false rather than being required, so a
// region can still be created from `{slug, name}` alone. The default is the
// restrictive side on purpose: a region whose staff never thought about the
// question must not silently accept double entries.
export const RegionCreateInputSchema = RegionSchema.omit({id: true}).extend({
  allowsDualEntry: z.boolean().default(false),
});
export type RegionCreateInput = z.infer<typeof RegionCreateInputSchema>;

// `slug` is part of already-published URLs, so it is fixed at creation time:
// picking only the editable fields means a `slug` sent by a client is
// dropped rather than applied. Both fields are optional because this is a
// PATCH: an omitted field keeps the region's current value, so flipping the
// dual-entry setting does not have to resend a `name` read before another
// staff member renamed the region — which would write the stale name back.
// An empty body is refused instead, since it can only be a client bug.
export const RegionUpdateInputSchema = RegionSchema.pick({
  name: true,
  allowsDualEntry: true,
})
  .partial()
  .refine(input => Object.keys(input).length > 0, {
    message: 'name または allowsDualEntry のどちらかは指定してください',
  });
export type RegionUpdateInput = z.infer<typeof RegionUpdateInputSchema>;
