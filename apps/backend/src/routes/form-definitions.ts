import {Hono} from 'hono';
import {
  FormDefinitionUploadSchema,
  parseFormDefinitionYaml,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {
  byTournamentIdParam,
  requireOpenEntryPeriodOrStaff,
} from '../middleware/entry-period';
import {internalError} from '../lib/errors';
import {
  syncFormFieldDefs,
  TournamentNotFoundError,
  TournamentSlugMismatchError,
} from '../lib/form-definitions';
import {fetchFormFieldDefs} from '../lib/form-field-defs';
import {TournamentIdParamSchema} from './params';
import {validate} from '../middleware/validate';

// The staff-only upload gets `requireGeneralStaff()` attached per-route
// rather than through `.use('*', ...)`, because the read below is public
// while the entry period is open: the entry form has to render a
// tournament's custom fields for a visitor with no session, and a
// definition carries no personal data. Outside the period the definitions
// *are* the unpublished form, so that read is gated the same way the
// tournament and regulation reads are.
export const formDefinitionsRoute = new Hono<StaffEnv>()
  .get(
    '/:tournamentId',
    validate('param', TournamentIdParamSchema),
    requireOpenEntryPeriodOrStaff(byTournamentIdParam),
    async c => {
      const db = c.get('db');
      const {fieldDefs, error} = await fetchFormFieldDefs(
        db,
        c.req.valid('param').tournamentId,
      );
      if (error) {
        return c.json(
          internalError('failed to read the form field defs', error),
          500,
        );
      }
      return c.json(fieldDefs);
    },
  )
  .put(
    '/:tournamentId',
    requireGeneralStaff(),
    validate('param', TournamentIdParamSchema),
    validate('json', FormDefinitionUploadSchema),
    async c => {
      let parsed;
      try {
        parsed = parseFormDefinitionYaml(c.req.valid('json').yaml);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'invalid yaml';
        return c.json({error: message}, 400);
      }

      try {
        await syncFormFieldDefs(
          c.get('db'),
          c.req.valid('param').tournamentId,
          parsed,
        );
      } catch (e: unknown) {
        if (e instanceof TournamentNotFoundError) {
          return c.json({error: 'tournament not found'}, 404);
        }
        // A slug/tournament mismatch is a staff mistake in the uploaded
        // YAML, and nothing has been written yet — the sync is skipped
        // entirely, so the tournament's existing definitions survive.
        if (e instanceof TournamentSlugMismatchError) {
          return c.json({error: e.message}, 400);
        }
        // Unexpected failures here (Supabase outage, unmapped insert
        // errors, etc.) are server-side, not the client's fault.
        return c.json(
          internalError('failed to sync the form field defs', e),
          500,
        );
      }

      return c.json({ok: true});
    },
  );
