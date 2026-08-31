import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  TournamentCreateInputSchema,
  TournamentTypeSchema,
  TournamentUpdateInputSchema,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {
  byTournamentSlugParams,
  requireOpenEntryPeriodOrStaff,
} from '../middleware/entry-period';
import {createDbClient} from '../lib/db';
import {internalError} from '../lib/errors';
import {rowToTournament, type TournamentRow} from '../lib/tournaments';

const TournamentIdParamSchema = z.object({id: z.string().uuid()});
const TournamentBySlugParamSchema = z.object({
  regionSlug: z.string(),
  tournamentSlug: TournamentTypeSchema,
});

/**
 * Maps the camelCase fields the client sends to the snake_case columns
 * `tournaments` actually has. Used for both create (all fields present) and
 * update (only the fields the caller chose to change).
 */
function toTournamentRow(
  input: Partial<z.infer<typeof TournamentCreateInputSchema>>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (input.regionId !== undefined) {
    row.region_id = input.regionId;
  }
  if (input.type !== undefined) {
    row.type = input.type;
  }
  if (input.name !== undefined) {
    row.name = input.name;
  }
  if (input.capacity !== undefined) {
    row.capacity = input.capacity;
  }
  if (input.entryOpensAt !== undefined) {
    row.entry_opens_at = input.entryOpensAt;
  }
  if (input.entryClosesAt !== undefined) {
    row.entry_closes_at = input.entryClosesAt;
  }
  return row;
}

// Middleware is attached per-route (not via `.use('*', ...)`) because this
// app is mounted at `/tournaments` alongside the public entries and
// entry-list routes (`routes/entries.ts`, `routes/entry-list.ts`, also
// mounted at `/tournaments`) — a wildcard here would match requests to
// `/tournaments/:tournamentId/entries` and `/tournaments/:tournamentId/entry-list`
// too, since Hono matches middleware by the request's final path, not by
// which sub-app originally registered it.
export const tournamentsRoute = new Hono<StaffEnv>()
  .get('/', requireGeneralStaff(), async c => {
    const db = createDbClient(c.env);
    const {data, error} = await db.from('tournaments').select('*');
    if (error) {
      return c.json(
        internalError('failed to read the tournaments', error),
        500,
      );
    }
    return c.json((data as TournamentRow[]).map(rowToTournament));
  })
  .post(
    '/',
    requireGeneralStaff(),
    zValidator('json', TournamentCreateInputSchema),
    async c => {
      const db = createDbClient(c.env);
      const {data, error} = await db
        .from('tournaments')
        .insert(toTournamentRow(c.req.valid('json')))
        .select()
        .single();
      if (error) {
        return c.json({error: error.message}, 400);
      }
      return c.json(rowToTournament(data as TournamentRow), 201);
    },
  )
  .patch(
    '/:id',
    requireGeneralStaff(),
    zValidator('param', TournamentIdParamSchema),
    zValidator('json', TournamentUpdateInputSchema),
    async c => {
      const db = createDbClient(c.env);
      const {data, error} = await db
        .from('tournaments')
        .update(toTournamentRow(c.req.valid('json')))
        .eq('id', c.req.valid('param').id)
        .select()
        .single();
      if (error) {
        // PGRST116: `.single()` found no matching row to update. Its
        // message is about the query shape, so it's replaced with the same
        // wording the reads above use for a missing tournament; a 400 is a
        // constraint the staff UI can act on, so that message stays.
        if (error.code === 'PGRST116') {
          return c.json({error: 'tournament not found'}, 404);
        }
        return c.json({error: error.message}, 400);
      }
      return c.json(rowToTournament(data as TournamentRow));
    },
  )
  // Public while the entry period is open, and the tournament's own staff
  // only outside it -- the gate is the middleware, which has already read
  // (and rejected, or stashed) the tournament by the time this runs.
  .get(
    '/:regionSlug/:tournamentSlug',
    zValidator('param', TournamentBySlugParamSchema),
    requireOpenEntryPeriodOrStaff(byTournamentSlugParams),
    async c => {
      const tournament = c.get('tournament');
      if (!tournament) {
        // Unreachable: the middleware answers 404 itself when there is no
        // such tournament. Written out rather than asserted so the handler
        // typechecks without a non-null assertion.
        return c.json({error: 'tournament not found'}, 404);
      }
      return c.json(rowToTournament(tournament));
    },
  );
