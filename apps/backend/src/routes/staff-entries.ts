import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {EntrySchema, type Entry, type EntryStatus} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {
  requireStaffForEntry,
  requireStaffForTournament,
} from '../middleware/staff-auth';
import {createDbClient} from '../lib/db';

const TournamentIdParamSchema = z.object({tournamentId: z.string().uuid()});
const EntryIdParamSchema = z.object({entryId: z.string().uuid()});

const ENTRY_COLUMNS =
  'id, tournament_id, name, furigana, display_name, regulation_id, ' +
  'free_text, custom_field_values, status, waitlist_position';

/** Shape of an `entries` row as selected above (snake_case). */
interface EntryRow {
  id: string;
  tournament_id: string;
  name: string;
  furigana: string;
  display_name: string;
  regulation_id: string;
  free_text: string | null;
  custom_field_values: Record<string, string | string[]>;
  status: EntryStatus;
  waitlist_position: number | null;
}

function rowToEntry(row: EntryRow): Entry {
  return EntrySchema.parse({
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    furigana: row.furigana,
    displayName: row.display_name,
    regulationId: row.regulation_id,
    freeText: row.free_text,
    customFieldValues: row.custom_field_values,
    status: row.status,
    waitlistPosition: row.waitlist_position,
  });
}

export const staffEntriesRoute = new Hono<StaffEnv>()
  .get(
    '/tournaments/:tournamentId/entries',
    requireStaffForTournament(),
    zValidator('param', TournamentIdParamSchema),
    async c => {
      const db = createDbClient(c.env);
      const {data, error} = await db
        .from('entries')
        .select(ENTRY_COLUMNS)
        .eq('tournament_id', c.req.valid('param').tournamentId)
        .order('created_at', {ascending: true})
        .returns<EntryRow[]>();
      if (error) {
        return c.json({error: error.message}, 500);
      }
      return c.json((data ?? []).map(rowToEntry));
    },
  )
  .get(
    '/entries/:entryId',
    requireStaffForEntry(),
    zValidator('param', EntryIdParamSchema),
    async c => {
      const db = createDbClient(c.env);
      const {data, error} = await db
        .from('entries')
        .select(ENTRY_COLUMNS)
        .eq('id', c.req.valid('param').entryId)
        .returns<EntryRow[]>()
        .maybeSingle();
      if (error) {
        return c.json({error: error.message}, 500);
      }
      if (!data) {
        return c.json({error: 'entry not found'}, 404);
      }
      return c.json(rowToEntry(data));
    },
  );
