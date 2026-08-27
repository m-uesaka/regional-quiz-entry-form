import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {RegulationSchema, type Regulation} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {createDbClient} from '../lib/db';

const TournamentIdParamSchema = z.object({tournamentId: z.string().uuid()});

const REGULATION_COLUMNS =
  'id, tournament_id, label, priority_starts_at, priority_ends_at, ' +
  'display_order';

/** Shape of a `regulations` row as selected above (snake_case). */
interface RegulationRow {
  id: string;
  tournament_id: string;
  label: string;
  priority_starts_at: string | null;
  priority_ends_at: string | null;
  display_order: number;
}

function rowToRegulation(row: RegulationRow): Regulation {
  return RegulationSchema.parse({
    id: row.id,
    tournamentId: row.tournament_id,
    label: row.label,
    priorityStartsAt: row.priority_starts_at,
    priorityEndsAt: row.priority_ends_at,
    displayOrder: row.display_order,
  });
}

// Public: the entry form has to show which regulations a participant may
// pick before they have any session at all, and a regulation carries no
// personal data — only its label and priority window, both of which the
// form displays.
export const regulationsRoute = new Hono<Env>().get(
  '/:tournamentId/regulations',
  zValidator('param', TournamentIdParamSchema),
  async c => {
    const db = createDbClient(c.env);
    const {data, error} = await db
      .from('regulations')
      .select(REGULATION_COLUMNS)
      .eq('tournament_id', c.req.valid('param').tournamentId)
      .order('display_order', {ascending: true})
      .returns<RegulationRow[]>();
    if (error) {
      // Anonymously reachable, so the raw Supabase message stays in the
      // log rather than in the response.
      console.error('failed to read regulations', error);
      return c.json({error: 'internal server error'}, 500);
    }
    return c.json(data.map(rowToRegulation));
  },
);
