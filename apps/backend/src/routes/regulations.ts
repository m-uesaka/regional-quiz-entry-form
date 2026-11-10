import {Hono} from 'hono';
import {
  RegulationSchema,
  RegulationSyncInputSchema,
  type Regulation,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {
  byTournamentIdParam,
  requireOpenEntryPeriodOrStaff,
} from '../middleware/entry-period';
import {createDbClient, type Tables} from '../lib/db';
import {internalError} from '../lib/errors';
import {
  NoLastingRegulationError,
  RegulationInUseError,
  syncRegulations,
  UnknownRegulationError,
} from '../lib/regulations';
import {TournamentNotFoundError} from '../lib/tournament-errors';
import {TournamentIdParamSchema} from './params';
import {validate} from '../middleware/validate';

const REGULATION_COLUMNS = `
  id, tournament_id, label, priority_starts_at, priority_ends_at,
  closes_with_priority, display_order
`;

/** Shape of a `regulations` row as selected above (snake_case). */
type RegulationRow = Pick<
  Tables<'regulations'>,
  | 'id'
  | 'tournament_id'
  | 'label'
  | 'priority_starts_at'
  | 'priority_ends_at'
  | 'closes_with_priority'
  | 'display_order'
>;

function rowToRegulation(row: RegulationRow): Regulation {
  return RegulationSchema.parse({
    id: row.id,
    tournamentId: row.tournament_id,
    label: row.label,
    priorityStartsAt: row.priority_starts_at,
    priorityEndsAt: row.priority_ends_at,
    closesWithPriority: row.closes_with_priority,
    displayOrder: row.display_order,
  });
}

// The read is public *while the entry period is open*: the entry form has
// to show which regulations a participant may pick before they have any
// session at all, and a regulation carries no personal data — only its
// label and priority window, both of which the form displays. Outside the
// period it is part of the form the requirement keeps unpublished, so the
// same gate the tournament read uses applies here too. The write next to it
// is general-staff only, so the middleware is attached per-route rather
// than through `.use('*', ...)` (same shape as `formDefinitionsRoute`).
export const regulationsRoute = new Hono<StaffEnv>()
  .get(
    '/:tournamentId/regulations',
    validate('param', TournamentIdParamSchema),
    requireOpenEntryPeriodOrStaff(byTournamentIdParam),
    async c => {
      const db = createDbClient(c.env);
      const {data, error} = await db
        .from('regulations')
        .select(REGULATION_COLUMNS)
        .eq('tournament_id', c.req.valid('param').tournamentId)
        .order('display_order', {ascending: true});
      if (error) {
        return c.json(
          internalError('failed to read the regulations', error),
          500,
        );
      }
      return c.json(data.map(rowToRegulation));
    },
  )
  // Whole-tournament replace, mirroring `PUT /api/form-definitions/:id`:
  // the body carries the regulations as they should look afterwards, and
  // there are no per-regulation POST/PATCH/DELETE endpoints.
  .put(
    '/:tournamentId/regulations',
    requireGeneralStaff(),
    validate('param', TournamentIdParamSchema),
    validate('json', RegulationSyncInputSchema),
    async c => {
      try {
        await syncRegulations(
          c.env,
          c.req.valid('param').tournamentId,
          c.req.valid('json').regulations,
        );
      } catch (e: unknown) {
        if (e instanceof TournamentNotFoundError) {
          return c.json({error: 'tournament not found'}, 404);
        }
        // These are staff mistakes the submitted form can be corrected for,
        // and nothing has been written — the sync is one transaction — so
        // the message says what to fix (naming the offending regulations
        // where there are any) and is rendered by the staff screen verbatim.
        if (
          e instanceof UnknownRegulationError ||
          e instanceof NoLastingRegulationError
        ) {
          return c.json({error: e.message}, 400);
        }
        if (e instanceof RegulationInUseError) {
          return c.json({error: e.message}, 409);
        }
        return c.json(internalError('failed to sync the regulations', e), 500);
      }

      return c.json({ok: true});
    },
  );
