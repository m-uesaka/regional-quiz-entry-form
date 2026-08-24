import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  TournamentSchema,
  TournamentTypeSchema,
  type Tournament,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {createDbClient} from '../lib/db';

const CreateTournamentSchema = TournamentSchema.omit({id: true});
const UpdateTournamentSchema = CreateTournamentSchema.partial();
const TournamentIdParamSchema = z.object({id: z.string().uuid()});
const TournamentBySlugParamSchema = z.object({
  regionSlug: z.string(),
  tournamentSlug: TournamentTypeSchema,
});

/** Shape of a `tournaments` row as returned by Supabase (snake_case). */
interface TournamentRow {
  id: string;
  region_id: string;
  type: string;
  name: string;
  capacity: number | null;
  entry_opens_at: string;
  entry_closes_at: string;
}

function rowToTournament(row: TournamentRow): Tournament {
  return TournamentSchema.parse({
    id: row.id,
    regionId: row.region_id,
    type: row.type,
    name: row.name,
    capacity: row.capacity,
    entryOpensAt: row.entry_opens_at,
    entryClosesAt: row.entry_closes_at,
  });
}

/**
 * Maps the camelCase fields the client sends to the snake_case columns
 * `tournaments` actually has. Used for both create (all fields present) and
 * update (only the fields the caller chose to change).
 */
function toTournamentRow(
  input: Partial<z.infer<typeof CreateTournamentSchema>>,
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
// app is mounted at `/tournaments` alongside the public entries route
// (`routes/entries.ts`, also mounted at `/tournaments`) — a wildcard here
// would match requests to `/tournaments/:tournamentId/entries` too, since
// Hono matches middleware by the request's final path, not by which
// sub-app originally registered it.
export const tournamentsRoute = new Hono<StaffEnv>()
  .get('/', requireGeneralStaff(), async c => {
    const db = createDbClient(c.env);
    const {data, error} = await db.from('tournaments').select('*');
    if (error) {
      return c.json({error: error.message}, 500);
    }
    return c.json((data as TournamentRow[]).map(rowToTournament));
  })
  .post(
    '/',
    requireGeneralStaff(),
    zValidator('json', CreateTournamentSchema),
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
    zValidator('json', UpdateTournamentSchema),
    async c => {
      const db = createDbClient(c.env);
      const {data, error} = await db
        .from('tournaments')
        .update(toTournamentRow(c.req.valid('json')))
        .eq('id', c.req.valid('param').id)
        .select()
        .single();
      if (error) {
        // PGRST116: `.single()` found no matching row to update.
        const status = error.code === 'PGRST116' ? 404 : 400;
        return c.json({error: error.message}, status);
      }
      return c.json(rowToTournament(data as TournamentRow));
    },
  )
  .get(
    '/:regionSlug/:tournamentSlug',
    zValidator('param', TournamentBySlugParamSchema),
    async c => {
      const {regionSlug, tournamentSlug} = c.req.valid('param');
      const db = createDbClient(c.env);
      const {data: region, error: regionError} = await db
        .from('regions')
        .select('id')
        .eq('slug', regionSlug)
        .maybeSingle();
      if (regionError) {
        return c.json({error: regionError.message}, 500);
      }
      if (!region) {
        return c.json({error: 'tournament not found'}, 404);
      }
      const {data: tournament, error: tournamentError} = await db
        .from('tournaments')
        .select('*')
        .eq('region_id', region.id)
        .eq('type', tournamentSlug)
        .maybeSingle();
      if (tournamentError) {
        return c.json({error: tournamentError.message}, 500);
      }
      if (!tournament) {
        return c.json({error: 'tournament not found'}, 404);
      }
      return c.json(rowToTournament(tournament as TournamentRow));
    },
  );
