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
import {
  fetchTournamentById,
  rowToTournament,
  TournamentLookupError,
  type TournamentRow,
} from '../lib/tournaments';

const TournamentIdParamSchema = z.object({id: z.string().uuid()});

/**
 * The constraint violations a tournament write can run into that the staff
 * UI can act on, keyed by SQLSTATE, each with the Japanese message shown
 * above the form.
 *
 * Postgres's own messages name tables, columns and constraints, so they are
 * never passed through (#122): a violation listed here is answered with its
 * own wording, and anything else is an internal error.
 */
const TOURNAMENT_CONSTRAINT_MESSAGES: Readonly<Record<string, string>> = {
  // unique_violation: `unique (region_id, type)`.
  '23505': 'この地域には同じ種別の大会がすでにあります',
  // foreign_key_violation: `region_id` names no region.
  '23503': '指定された地域が存在しません',
};

/**
 * The response body and status for a failed tournament insert or update.
 * @param context What was being attempted, for the log line.
 * @param error The error supabase-js returned.
 */
function tournamentWriteError(
  context: string,
  error: {code?: string},
): {body: {error: string}; status: 400 | 500} {
  const message =
    error.code === undefined
      ? undefined
      : TOURNAMENT_CONSTRAINT_MESSAGES[error.code];
  if (message !== undefined) {
    return {body: {error: message}, status: 400};
  }
  return {body: internalError(context, error), status: 500};
}
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
  // For the edit screen, which used to fetch the whole list above just to
  // `find` one tournament in it (#123). One segment, so it can't collide
  // with the two-segment `/:regionSlug/:tournamentSlug` read below, nor with
  // the `/:tournamentId/...` routes mounted beside this app.
  .get(
    '/:id',
    requireGeneralStaff(),
    zValidator('param', TournamentIdParamSchema),
    async c => {
      let tournament: TournamentRow | null;
      try {
        tournament = await fetchTournamentById(c.env, c.req.valid('param').id);
      } catch (e: unknown) {
        const cause = e instanceof TournamentLookupError ? e.cause : e;
        return c.json(
          internalError('failed to read the tournament', cause),
          500,
        );
      }
      if (!tournament) {
        return c.json({error: 'tournament not found'}, 404);
      }
      return c.json(rowToTournament(tournament));
    },
  )
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
        const {body, status} = tournamentWriteError(
          'failed to create the tournament',
          error,
        );
        return c.json(body, status);
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
        // wording the reads above use for a missing tournament.
        if (error.code === 'PGRST116') {
          return c.json({error: 'tournament not found'}, 404);
        }
        const {body, status} = tournamentWriteError(
          'failed to update the tournament',
          error,
        );
        return c.json(body, status);
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
