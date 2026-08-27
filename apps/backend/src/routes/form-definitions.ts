import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  FormDefinitionUploadSchema,
  parseFormDefinitionYaml,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {createDbClient} from '../lib/db';
import {
  syncFormFieldDefs,
  TournamentNotFoundError,
  TournamentSlugMismatchError,
} from '../lib/form-definitions';
import {
  FORM_FIELD_DEF_COLUMNS,
  toFormFieldDef,
  type FormFieldDefRow,
} from '../lib/form-field-defs';

const TournamentIdParamSchema = z.object({tournamentId: z.string().uuid()});

// The staff-only upload gets `requireGeneralStaff()` attached per-route
// rather than through `.use('*', ...)`, because the read below is public:
// the entry form has to render a tournament's custom fields for a visitor
// with no session, and a definition carries no personal data.
export const formDefinitionsRoute = new Hono<StaffEnv>()
  .get(
    '/:tournamentId',
    zValidator('param', TournamentIdParamSchema),
    async c => {
      const db = createDbClient(c.env);
      const {data, error} = await db
        .from('form_field_defs')
        .select(FORM_FIELD_DEF_COLUMNS)
        .eq('tournament_id', c.req.valid('param').tournamentId)
        .order('display_order', {ascending: true})
        .returns<FormFieldDefRow[]>();
      if (error) {
        // Anonymously reachable, so the raw Supabase message stays in the
        // log rather than in the response — the same rule the PUT below
        // applies to its own unexpected failures.
        console.error('failed to read form field defs', error);
        return c.json({error: 'internal server error'}, 500);
      }
      return c.json(data.map(toFormFieldDef));
    },
  )
  .put(
    '/:tournamentId',
    requireGeneralStaff(),
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
