import {Hono} from 'hono';
import {
  RegulationSchema,
  RegulationSyncInputSchema,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {
  byTournamentIdParam,
  requireOpenEntryPeriodOrStaff,
} from '../middleware/entry-period';
import {UnexpectedFailure, unwrap} from '../lib/errors';
import {
  NoLastingRegulationError,
  RegulationInUseError,
  syncRegulations,
  UnknownRegulationError,
} from '../lib/regulations';
import {TournamentNotFoundError} from '../lib/tournament-errors';
import {TournamentIdParamSchema} from './params';
import {validate} from '../middleware/validate';

// Aliased to the API's names in the select itself, so a row is the
// `Regulation` shape and `RegulationSchema` only has to check it.
const REGULATION_COLUMNS = `
  id, tournamentId:tournament_id, label,
  priorityStartsAt:priority_starts_at, priorityEndsAt:priority_ends_at,
  closesWithPriority:closes_with_priority, displayOrder:display_order
`;

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
      const db = c.get('db');
      const data = unwrap(
        await db
          .from('regulations')
          .select(REGULATION_COLUMNS)
          .eq('tournament_id', c.req.valid('param').tournamentId)
          .order('display_order', {ascending: true}),
        'failed to read the regulations',
      );
      return c.json(data.map(row => RegulationSchema.parse(row)));
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
          c.get('db'),
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
        throw new UnexpectedFailure('failed to sync the regulations', e);
      }

      return c.json({ok: true});
    },
  );
