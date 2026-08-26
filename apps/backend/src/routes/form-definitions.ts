import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  FormDefinitionUploadSchema,
  parseFormDefinitionYaml,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {
  syncFormFieldDefs,
  TournamentNotFoundError,
  TournamentSlugMismatchError,
} from '../lib/form-definitions';

const TournamentIdParamSchema = z.object({tournamentId: z.string().uuid()});

export const formDefinitionsRoute = new Hono<StaffEnv>()
  .use('*', requireGeneralStaff())
  .put(
    '/:tournamentId',
    zValidator('param', TournamentIdParamSchema),
    zValidator('json', FormDefinitionUploadSchema),
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
          c.env,
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
        // errors, etc.) are server-side, not the client's fault, and
        // shouldn't leak raw database error messages.
        console.error('failed to sync form field defs', e);
        return c.json({error: 'internal server error'}, 500);
      }

      return c.json({ok: true});
    },
  );
