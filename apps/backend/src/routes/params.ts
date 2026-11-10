// Path parameter schemas shared by the route modules, for
// `validate('param', ...)`. A malformed id answers 400 there, before it
// reaches PostgREST as a `uuid` it cannot cast.

import {TournamentTypeSchema} from '@regional-quiz/shared';
import {z} from 'zod';

/** `/:id`, for the resource the route is about (region, account, ...). */
export const IdParamSchema = z.object({id: z.string().uuid()});

/** `/tournaments/:tournamentId/...`. */
export const TournamentIdParamSchema = z.object({
  tournamentId: z.string().uuid(),
});

/** `/entries/:entryId`. */
export const EntryIdParamSchema = z.object({entryId: z.string().uuid()});

/** `/tournaments/:regionSlug/:tournamentSlug/...`, the public by-slug paths. */
export const TournamentBySlugParamSchema = z.object({
  regionSlug: z.string(),
  tournamentSlug: TournamentTypeSchema,
});
