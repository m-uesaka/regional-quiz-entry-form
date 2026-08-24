import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {EntryListItemSchema, type EntryListItem} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {createDbClient} from '../lib/db';

const TournamentIdParamSchema = z.object({tournamentId: z.string().uuid()});

/** Shape of an `entries` row as selected below (snake_case). */
interface EntryListRow {
  display_name: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled';
  waitlist_position: number | null;
}

function rowToEntryListItem(row: EntryListRow): EntryListItem {
  return EntryListItemSchema.parse({
    // Cancelled entries are not removed from the ordering (no promotion
    // happens on cancellation), so the name is masked in place rather than
    // dropping the row.
    displayName: row.status === 'cancelled' ? 'キャンセル' : row.display_name,
    status: row.status,
    waitlistPosition: row.waitlist_position,
  });
}

export const entryListRoute = new Hono<Env>().get(
  '/:tournamentId/entry-list',
  zValidator('param', TournamentIdParamSchema),
  async c => {
    const db = createDbClient(c.env);
    const {data, error} = await db
      .from('entries')
      .select('display_name, status, waitlist_position, created_at')
      .eq('tournament_id', c.req.valid('param').tournamentId)
      .in('status', ['confirmed', 'waitlisted', 'cancelled'])
      .order('created_at', {ascending: true})
      .returns<EntryListRow[]>();
    if (error) {
      return c.json({error: error.message}, 500);
    }
    return c.json((data ?? []).map(rowToEntryListItem));
  },
);
