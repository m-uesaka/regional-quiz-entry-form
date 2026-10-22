import {Hono} from 'hono';
import type {Context} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  EntryListItemSchema,
  TournamentTypeSchema,
  type EntryListItem,
} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {createDbClient} from '../lib/db';
import {fetchAllRows} from '../lib/paged-select';
import {internalError} from '../lib/errors';
import {
  fetchTournamentBySlug,
  TournamentLookupError,
  type TournamentRow,
} from '../lib/tournaments';

const TournamentIdParamSchema = z.object({tournamentId: z.string().uuid()});
const TournamentBySlugParamSchema = z.object({
  regionSlug: z.string(),
  tournamentSlug: TournamentTypeSchema,
});

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

/**
 * Answers with a tournament's public entry list.
 *
 * Neither of the two routes below is gated on the entry period
 * (`middleware/entry-period.ts`), on purpose: the entry list is a published
 * result, and the moment it is read most is after entries have closed.
 * @param c The request context.
 * @param tournamentId The tournament whose entries to list.
 */
async function respondWithEntryList(c: Context<Env>, tournamentId: string) {
  const db = createDbClient(c.env);
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
}

export const entryListRoute = new Hono<Env>()
  .get(
    '/:tournamentId/entry-list',
    zValidator('param', TournamentIdParamSchema),
    async c => respondWithEntryList(c, c.req.valid('param').tournamentId),
  )
  // The slug-keyed twin of the route above, for the public list page, whose
  // URL names a tournament the way the entry form's does. It exists because
  // resolving the slug pair through `GET /tournaments/:regionSlug/:tournamentSlug`
  // stopped being an option for that page once the entry-period gate went
  // on it: the list has to stay readable after entries close, which is
  // exactly when that read starts refusing anyone who isn't staff.
  .get(
    '/:regionSlug/:tournamentSlug/entry-list',
    zValidator('param', TournamentBySlugParamSchema),
    async c => {
      const {regionSlug, tournamentSlug} = c.req.valid('param');
      let tournament: TournamentRow | null;
      try {
        tournament = await fetchTournamentBySlug(
          c.env,
          regionSlug,
          tournamentSlug,
        );
      } catch (e: unknown) {
        const cause = e instanceof TournamentLookupError ? e.cause : e;
        return c.json(
          internalError('failed to read the tournament', cause),
          500,
        );
      }
      if (!tournament) {
        return c.json({error: 'tournament not found'}, 404);
      }
      return respondWithEntryList(c, tournament.id);
    },
  );
