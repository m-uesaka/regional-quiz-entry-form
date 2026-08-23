import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  FormDefinitionUploadSchema,
  parseFormDefinitionYaml,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {syncFormFieldDefs} from '../lib/form-definitions';

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
        const message = e instanceof Error ? e.message : 'failed to sync';
        return c.json({error: message}, 400);
      }

      return c.json({ok: true});
    },
  );
