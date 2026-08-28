import {z} from 'zod';

// A region slug is used verbatim as one segment of the public entry form URL
// (`/{regionSlug}/{tournamentSlug}/entry`), so characters that mean something
// in a path or query string — and uppercase, which would make the URL
// case-sensitive to type — are rejected. The first character is pinned to a
// letter so a slug can never be mistaken for a UUID or a numeric id.
export const RegionSlugSchema = z.string().regex(/^[a-z][a-z0-9-]{1,30}$/, {
  message: 'slug は英小文字で始まり、英小文字・数字・ハイフンのみ使えます',
});

export const RegionSchema = z.object({
  id: z.string().uuid(),
  slug: RegionSlugSchema,
  name: z.string().min(1).max(100),
});
export type Region = z.infer<typeof RegionSchema>;

export const RegionCreateInputSchema = RegionSchema.omit({id: true});
export type RegionCreateInput = z.infer<typeof RegionCreateInputSchema>;

// `slug` is part of already-published URLs, so it is fixed at creation time:
// picking only `name` means a `slug` sent by a client is dropped rather than
// applied.
export const RegionUpdateInputSchema = RegionSchema.pick({name: true});
export type RegionUpdateInput = z.infer<typeof RegionUpdateInputSchema>;
