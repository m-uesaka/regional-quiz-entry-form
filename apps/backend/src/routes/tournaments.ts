import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  TournamentCreateInputSchema,
  TournamentOrderInputSchema,
  TournamentResetInputSchema,
  type TournamentResetResponse,
  TournamentTypeSchema,
  TournamentUpdateInputSchema,
  type TournamentUpdateResponse,
  type WaitlistPromotion,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {
  byTournamentSlugParams,
  requireOpenEntryPeriodOrStaff,
} from '../middleware/entry-period';
import {createDbClient} from '../lib/db';
import {internalError} from '../lib/errors';
import {
  FORM_FIELD_DEF_COLUMNS,
  toFormFieldDef,
  type FormFieldDefRow,
} from '../lib/form-field-defs';
import {
  rowToTournament,
  TOURNAMENT_COLUMNS,
  type TournamentRow,
} from '../lib/tournaments';
import {promoteWaitlistedEntries} from '../lib/waitlist';

const TournamentIdParamSchema = z.object({id: z.string().uuid()});

/**
 * Raised by `reorder_tournaments()` (0032) when the ids it is given aren't
 * exactly the tournaments there are.
 */
const TOURNAMENT_IDS_MISMATCH_SQLSTATE = 'P0003';

/**
 * The constraint violations a tournament write can run into that the staff
 * UI can act on, keyed by SQLSTATE, each with the Japanese message shown
 * above the form.
 *
 * Postgres's own messages name tables, columns and constraints, so they are
 * never passed through (#122): a violation listed here is answered with its
 * own wording, and anything else is an internal error.
 */
const TOURNAMENT_CONSTRAINT_MESSAGES: Readonly<Record<string, string>> = {
  // unique_violation: `unique (region_id, type)`.
  '23505': 'この地域には同じ種別の大会がすでにあります',
  // foreign_key_violation: `region_id` names no region.
  '23503': '指定された地域が存在しません',
};

/**
 * The response body and status for a failed tournament insert or update.
 * @param context What was being attempted, for the log line.
 * @param error The error supabase-js returned.
 */
function tournamentWriteError(
  context: string,
  error: {code?: string},
): {body: {error: string}; status: 400 | 500} {
  const message =
    error.code === undefined
      ? undefined
      : TOURNAMENT_CONSTRAINT_MESSAGES[error.code];
  if (message !== undefined) {
    return {body: {error: message}, status: 400};
  }
  return {body: internalError(context, error), status: 500};
}
/**
 * Raised by `reset_tournament_entries()` (0038) when the tournament's entry
 * period is open, so nothing was deleted.
 */
const ENTRY_PERIOD_OPEN_SQLSTATE = 'P0007';

/** What a tournament delete answers when entries still point at it. */
const TOURNAMENT_HAS_ENTRIES_MESSAGE = 'エントリーがある大会は削除できません';

/** The one row `reset_tournament_entries()` (0038) returns. */
interface ResetTournamentEntriesRow {
  deleted_entry_count: number;
  deleted_participant_count: number;
  kept_participant_count: number;
}

const TournamentBySlugParamSchema = z.object({
  regionSlug: z.string(),
  tournamentSlug: TournamentTypeSchema,
});

/**
 * Maps the camelCase fields the client sends to the snake_case columns
 * `tournaments` actually has. Used for both create (all fields present) and
 * update (only the fields the caller chose to change).
 */
function toTournamentRow(
  input: Partial<z.infer<typeof TournamentCreateInputSchema>>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (input.regionId !== undefined) {
    row.region_id = input.regionId;
  }
  if (input.type !== undefined) {
    row.type = input.type;
  }
  if (input.name !== undefined) {
    // Blank is stored as null, which reads back as the default name for the
    // tournament's region and type at the time (0024).
    row.name = input.name === '' ? null : input.name;
  }
  if (input.capacity !== undefined) {
    row.capacity = input.capacity;
  }
  if (input.entryOpensAt !== undefined) {
    row.entry_opens_at = input.entryOpensAt;
  }
  if (input.entryClosesAt !== undefined) {
    row.entry_closes_at = input.entryClosesAt;
  }
  return row;
}

// Middleware is attached per-route (not via `.use('*', ...)`) because this
// app is mounted at `/tournaments` alongside the public entries and
// entry-list routes (`routes/entries.ts`, `routes/entry-list.ts`, also
// mounted at `/tournaments`) — a wildcard here would match requests to
// `/tournaments/:tournamentId/entries` and `/tournaments/:tournamentId/entry-list`
// too, since Hono matches middleware by the request's final path, not by
// which sub-app originally registered it.
export const tournamentsRoute = new Hono<StaffEnv>()
  .get('/', requireGeneralStaff(), async c => {
    const db = createDbClient(c.env);
    const {data, error} = await db
      .from('tournaments')
      .select(TOURNAMENT_COLUMNS)
      // The order general staff set with `PUT /order` below.
      .order('display_order', {ascending: true})
      .order('id', {ascending: true})
      .returns<TournamentRow[]>();
    if (error) {
      return c.json(
        internalError('failed to read the tournaments', error),
        500,
      );
    }
    return c.json(data.map(rowToTournament));
  })
  // Sets the order every tournament list is shown in -- the portal, the
  // entry-list index, the dashboard and this API's list above -- from every
  // tournament's id in the order wanted. A PUT of the whole order rather
  // than a move of one tournament, so the result is exactly what the staff
  // member saw on screen; and a list that isn't exactly the tournaments
  // there are (one created or deleted since the screen was opened) is
  // refused with 409 rather than placed by guesswork.
  //
  // `/order` is one segment and a PUT, so it collides with neither
  // `PATCH /:id` nor the `/:tournamentId/...` routes mounted beside this.
  .put(
    '/order',
    requireGeneralStaff(),
    zValidator('json', TournamentOrderInputSchema),
    async c => {
      const {error} = await createDbClient(c.env).rpc('reorder_tournaments', {
        p_tournament_ids: c.req.valid('json').tournamentIds,
      });
      if (error) {
        if (error.code === TOURNAMENT_IDS_MISMATCH_SQLSTATE) {
          return c.json(
            {
              error:
                '並べ替えの間に大会が追加または削除されました。ページを読み込み直してから、もう一度並べ替えてください',
            },
            409,
          );
        }
        return c.json(
          internalError('failed to reorder the tournaments', error),
          500,
        );
      }
      return c.body(null, 204);
    },
  )
  // For the edit screen, which used to fetch the whole list above just to
  // `find` one tournament in it (#123). One segment, so it can't collide
  // with the two-segment `/:regionSlug/:tournamentSlug` read below, nor with
  // the `/:tournamentId/...` routes mounted beside this app.
  //
  // The form fields come along in the same query rather than from
  // `GET /api/form-definitions/:tournamentId`, whose entry-period gate would
  // read the tournament a second time. `customName` is the 大会名 as typed,
  // null when it was left blank, so the form can show it blank again
  // instead of the default name `tournament.name` carries.
  .get(
    '/:id',
    requireGeneralStaff(),
    zValidator('param', TournamentIdParamSchema),
    async c => {
      const db = createDbClient(c.env);
      const {data, error} = await db
        .from('tournaments')
        .select(
          `${TOURNAMENT_COLUMNS}, form_field_defs(${FORM_FIELD_DEF_COLUMNS})`,
        )
        .eq('id', c.req.valid('param').id)
        .order('display_order', {
          referencedTable: 'form_field_defs',
          ascending: true,
        })
        .returns<(TournamentRow & {form_field_defs: FormFieldDefRow[]})[]>()
        .maybeSingle();
      if (error) {
        return c.json(
          internalError('failed to read the tournament', error),
          500,
        );
      }
      if (!data) {
        return c.json({error: 'tournament not found'}, 404);
      }
      return c.json({
        tournament: rowToTournament(data),
        customName: data.name,
        formFieldDefs: data.form_field_defs.map(toFormFieldDef),
      });
    },
  )
  .post(
    '/',
    requireGeneralStaff(),
    zValidator('json', TournamentCreateInputSchema),
    async c => {
      const db = createDbClient(c.env);
      const {data, error} = await db
        .from('tournaments')
        .insert(toTournamentRow(c.req.valid('json')))
        .select(TOURNAMENT_COLUMNS)
        .returns<TournamentRow[]>()
        .single();
      if (error) {
        const {body, status} = tournamentWriteError(
          'failed to create the tournament',
          error,
        );
        return c.json(body, status);
      }
      return c.json(rowToTournament(data), 201);
    },
  )
  .patch(
    '/:id',
    requireGeneralStaff(),
    zValidator('param', TournamentIdParamSchema),
    zValidator('json', TournamentUpdateInputSchema),
    async c => {
      const db = createDbClient(c.env);
      const {id} = c.req.valid('param');
      const input = c.req.valid('json');
      const {data, error} = await db
        .from('tournaments')
        .update(toTournamentRow(input))
        .eq('id', id)
        .select(TOURNAMENT_COLUMNS)
        .returns<TournamentRow[]>()
        .single();
      if (error) {
        // PGRST116: `.single()` found no matching row to update. Its
        // message is about the query shape, so it's replaced with the same
        // wording the reads above use for a missing tournament.
        if (error.code === 'PGRST116') {
          return c.json({error: 'tournament not found'}, 404);
        }
        const {body, status} = tournamentWriteError(
          'failed to update the tournament',
          error,
        );
        return c.json(body, status);
      }
      // A capacity raised or cleared frees seats the waitlist is queued for
      // (#223). Run whenever a capacity was sent rather than only when it
      // went up: the function finds the free seats itself under the
      // tournament lock, and does nothing when there are none.
      let promotion: WaitlistPromotion | null = {
        promotedCount: 0,
        mailFailedCount: 0,
      };
      if (input.capacity !== undefined) {
        try {
          promotion = await promoteWaitlistedEntries(c.env, id, {db});
        } catch (e: unknown) {
          // The update is already committed, so failing the request would
          // tell staff it didn't go through. `promotion: null` says the
          // promotion didn't; saving the capacity again retries it.
          console.error('failed to promote waitlisted entries', {
            tournamentId: id,
            error: e,
          });
          promotion = null;
        }
      }
      const body: TournamentUpdateResponse = {
        ...rowToTournament(data),
        promotion,
      };
      return c.json(body);
    },
  )
  // For a tournament created by mistake. Its regulations, form fields and
  // mail jobs go with it (`on delete cascade`, 0023), but its entries do
  // not: they are participants' personal data and their record of having
  // entered, so a tournament anyone has entered is refused instead.
  .delete(
    '/:id',
    requireGeneralStaff(),
    zValidator('param', TournamentIdParamSchema),
    async c => {
      const db = createDbClient(c.env);
      const {data, error} = await db
        .from('tournaments')
        .delete()
        .eq('id', c.req.valid('param').id)
        .select('id');
      if (error) {
        // foreign_key_violation: `entries.tournament_id` still points here.
        if (error.code === '23503') {
          return c.json({error: TOURNAMENT_HAS_ENTRIES_MESSAGE}, 409);
        }
        return c.json(
          internalError('failed to delete the tournament', error),
          500,
        );
      }
      if (data.length === 0) {
        return c.json({error: 'tournament not found'}, 404);
      }
      return c.body(null, 204);
    },
  )
  // Empties a tournament of its participant data -- every entry, and with
  // `deleteParticipants` their accounts too -- while keeping the tournament,
  // its regulations and form fields, all inside `reset_tournament_entries()`
  // (0038) so it happens in one transaction. 統括スタッフ only: regional
  // staff can read and mail their own tournament's entries, but nothing
  // that wipes them, since a slip here can't be undone. For the same reason
  // a tournament whose entry period is open is refused (409): its entries
  // are the edition being run, not a past one being cleared. A POST rather than
  // `DELETE /:id/entries` because it carries a body, and `/reset` collides
  // with neither the public `POST /:tournamentId/entries` nor anything else
  // mounted at `/tournaments`.
  .post(
    '/:id/reset',
    requireGeneralStaff(),
    zValidator('param', TournamentIdParamSchema),
    zValidator('json', TournamentResetInputSchema),
    async c => {
      const {data, error} = await createDbClient(c.env).rpc(
        'reset_tournament_entries',
        {
          p_tournament_id: c.req.valid('param').id,
          p_delete_participants: c.req.valid('json').deleteParticipants,
        },
      );
      if (error) {
        if (error.code === ENTRY_PERIOD_OPEN_SQLSTATE) {
          return c.json(
            {error: 'エントリー期間中の大会はリセットできません'},
            409,
          );
        }
        return c.json(
          internalError('failed to reset the tournament entries', error),
          500,
        );
      }
      // Cast rather than `.returns()`, for the reason `lib/waitlist.ts`
      // gives: the client isn't built with generated Database types.
      const [row] = (data as ResetTournamentEntriesRow[] | null) ?? [];
      if (!row) {
        return c.json({error: 'tournament not found'}, 404);
      }
      const body: TournamentResetResponse = {
        deletedEntryCount: row.deleted_entry_count,
        deletedParticipantCount: row.deleted_participant_count,
        keptParticipantCount: row.kept_participant_count,
      };
      return c.json(body);
    },
  )
  // Public while the entry period is open, and the tournament's own staff
  // only outside it -- the gate is the middleware, which has already read
  // (and rejected, or stashed) the tournament by the time this runs.
  .get(
    '/:regionSlug/:tournamentSlug',
    zValidator('param', TournamentBySlugParamSchema),
    requireOpenEntryPeriodOrStaff(byTournamentSlugParams),
    async c => {
      const tournament = c.get('tournament');
      if (!tournament) {
        // Unreachable: the middleware answers 404 itself when there is no
        // such tournament. Written out rather than asserted so the handler
        // typechecks without a non-null assertion.
        return c.json({error: 'tournament not found'}, 404);
      }
      return c.json(rowToTournament(tournament));
    },
  );
