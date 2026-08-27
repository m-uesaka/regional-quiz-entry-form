import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {EntryListItemSchema, type EntryListItem} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {createDbClient} from '../lib/db';
import {fetchAllRows} from '../lib/paged-select';
import {internalError} from '../lib/errors';

const TournamentIdParamSchema = z.object({tournamentId: z.string().uuid()});

/** Shape of an `entries` row as selected below (snake_case). */
interface EntryListRow {
  display_name: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled';
  waitlist_position: number | null;
}

function rowToEntryListItem(row: EntryListRow): EntryListItem {
  return EntryListItemSchema.parse({
    // Cancelling a confirmed entry does promote the next waitlisted entry
    // (see `promoteNextWaitlistedEntry`), but that only updates the
    // promoted entry's own row — the cancelled row itself is kept, not
    // removed, so its name is masked in place here rather than dropping
    // the row.
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
    const {tournamentId} = c.req.valid('param');
    const {rows, error} = await fetchAllRows<EntryListRow>((from, to) =>
      db
        .from('entries')
        .select('display_name, status, waitlist_position, created_at')
        .eq('tournament_id', tournamentId)
        .in('status', ['confirmed', 'waitlisted', 'cancelled'])
        .order('created_at', {ascending: true})
        .order('id', {ascending: true})
        .range(from, to)
        .returns<EntryListRow[]>(),
    );
    if (error) {
      return c.json(internalError('failed to read the entry list', error), 500);
    }
    return c.json(rows.map(rowToEntryListItem));
  },
);
