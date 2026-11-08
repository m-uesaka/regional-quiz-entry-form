import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {
  ENTRY_PERIOD_ORDER_MESSAGE,
  QuestionSetListSchema,
  TournamentCreateInputSchema,
  TournamentDetailSchema,
  TournamentOrderInputSchema,
  TournamentResetInputSchema,
  type TournamentCreateInput,
  type TournamentResetResponse,
  TOURNAMENT_REGION_TYPE_LOCKED_MESSAGE,
  TournamentUpdateInputSchema,
  type TournamentUpdateInput,
  type TournamentUpdateResponse,
  type WaitlistPromotion,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {
  byTournamentSlugParams,
  requireOpenEntryPeriodOrStaff,
} from '../middleware/entry-period';
import {createDbClient, type TablesInsert, type TablesUpdate} from '../lib/db';
import {internalError} from '../lib/errors';
import {FORM_FIELD_DEF_COLUMNS, toFormFieldDef} from '../lib/form-field-defs';
import {
  badRequest,
  CHECK_VIOLATION_SQLSTATE,
  constraintKey,
  DUAL_ENTRY_SHARED_QUESTION_SET_MESSAGE,
  DUAL_ENTRY_SHARED_QUESTION_SET_SQLSTATE,
  duplicate,
  ENTRY_PERIOD_OPEN_SQLSTATE,
  FOREIGN_KEY_VIOLATION_SQLSTATE,
  mapPgError,
  NO_ROW_PGRST_CODE,
  noRow,
  type PgErrorTable,
  stillReferenced,
  TOURNAMENT_IDS_MISMATCH_SQLSTATE,
  TOURNAMENT_REGION_TYPE_LOCKED_SQLSTATE,
  UNIQUE_VIOLATION_SQLSTATE,
} from '../lib/pg-errors';
import {rowToTournament, TOURNAMENT_COLUMNS} from '../lib/tournaments';
import {promoteWaitlistedEntries} from '../lib/waitlist';
import {IdParamSchema, TournamentBySlugParamSchema} from './params';

/**
 * The constraint violations a tournament insert or update can run into that
 * the staff UI can act on, each with the Japanese message shown above the
 * form.
 *
 * Postgres's own messages name tables, columns and constraints, so they are
 * never passed through (#122): a violation listed here is answered with its
 * own wording, and anything else is an internal error.
 */
const TOURNAMENT_WRITE_ERRORS = {
  // `unique (region_id, type)`.
  [UNIQUE_VIOLATION_SQLSTATE]: duplicate(
    'この地域には同じ種別の大会がすでにあります',
  ),
  // `region_id` names no region.
  [FOREIGN_KEY_VIOLATION_SQLSTATE]: badRequest('指定された地域が存在しません'),
  // `tournaments_entry_period_ordered` (0048): a PATCH sent one end of the
  // entry period, and it doesn't come before (or after) the stored other
  // end -- the request schemas check the period whenever both ends are
  // sent -- or a PATCH that left alone a period stored out of order before
  // 0048 added the check `not valid`. The table's other checks -- a capacity below 1
  // (`tournaments_capacity_positive`, 0048) and a question set not in its
  // stored form (`tournaments_question_set_format`, 0044) -- are ruled out
  // by the request schemas, so one of those is a bug and is left to the
  // 500.
  [constraintKey(CHECK_VIOLATION_SQLSTATE, 'tournaments_entry_period_ordered')]:
    badRequest(ENTRY_PERIOD_ORDER_MESSAGE),
  // The other tournament of a region allowing dual entry has the same
  // question set (0045).
  [DUAL_ENTRY_SHARED_QUESTION_SET_SQLSTATE]: {
    status: 409,
    error: DUAL_ENTRY_SHARED_QUESTION_SET_MESSAGE,
  },
  // A PATCH would move a tournament that has entries to another region or
  // type (0050, #284). Only an update can raise it.
  [TOURNAMENT_REGION_TYPE_LOCKED_SQLSTATE]: {
    status: 409,
    error: TOURNAMENT_REGION_TYPE_LOCKED_MESSAGE,
  },
} as const satisfies PgErrorTable<400 | 409>;

/**
 * The order `/question-sets` lists names in: Japanese collation (kana in
 * 五十音 order, kanji by code rather than by reading). Made once rather than
 * per comparison, as `localeCompare()` would.
 */
const QUESTION_SET_ORDER = new Intl.Collator('ja');

/** What a tournament delete answers when entries still point at it. */
const TOURNAMENT_HAS_ENTRIES_MESSAGE = 'エントリーがある大会は削除できません';

/**
 * How a tournament name the client sent is stored: blank is stored as null,
 * which reads back as the default name for the tournament's region and type
 * at the time (0024).
 */
function storedTournamentName(name: string): string | null {
  return name === '' ? null : name;
}

/**
 * Maps a create body to the snake_case columns `tournaments` has. Every
 * column is listed, so the return type checks that each one an insert
 * requires is set.
 */
function toTournamentInsert(
  input: TournamentCreateInput,
): TablesInsert<'tournaments'> {
  return {
    region_id: input.regionId,
    type: input.type,
    name: storedTournamentName(input.name),
    capacity: input.capacity,
    entry_opens_at: input.entryOpensAt,
    entry_closes_at: input.entryClosesAt,
    question_set: input.questionSet,
  };
}

/**
 * Maps a PATCH body to the snake_case columns `tournaments` has, leaving out
 * every field the caller did not send so the update changes only those.
 */
function toTournamentUpdate(
  input: TournamentUpdateInput,
): TablesUpdate<'tournaments'> {
  const row: TablesUpdate<'tournaments'> = {};
  if (input.regionId !== undefined) {
    row.region_id = input.regionId;
  }
  if (input.type !== undefined) {
    row.type = input.type;
  }
  if (input.name !== undefined) {
    row.name = storedTournamentName(input.name);
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
  // Null is sent, not left out, to go back to the common questions.
  if (input.questionSet !== undefined) {
    row.question_set = input.questionSet;
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
      .order('id', {ascending: true});
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
        const {body, status} = mapPgError(
          error,
          {
            [TOURNAMENT_IDS_MISMATCH_SQLSTATE]: {
              status: 409,
              error:
                '並べ替えの間に大会が追加または削除されました。ページを読み込み直してから、もう一度並べ替えてください',
            },
          },
          'failed to reorder the tournaments',
        );
        return c.json(body, status);
      }
      return c.body(null, 204);
    },
  )
  // The question set names tournaments use (0043), distinct and sorted, for
  // the create and edit forms to suggest: a name typed slightly differently
  // counts as another question set. Its own read rather than the list above,
  // which the edit screen stopped fetching (#123). Registered before `/:id`,
  // which would otherwise take `question-sets` for an id and refuse it.
  .get('/question-sets', requireGeneralStaff(), async c => {
    const {data, error} = await createDbClient(c.env)
      .from('tournaments')
      .select('question_set')
      .not('question_set', 'is', null);
    if (error) {
      return c.json(
        internalError('failed to read the question sets', error),
        500,
      );
    }
    // `.not('is', null)` above keeps nulls out; the filter is only for the
    // column's nullable type.
    const names = new Set(
      data.flatMap(row =>
        row.question_set === null ? [] : [row.question_set],
      ),
    );
    return c.json(
      QuestionSetListSchema.parse([...names].sort(QUESTION_SET_ORDER.compare)),
    );
  })
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
    zValidator('param', IdParamSchema),
    async c => {
      const db = createDbClient(c.env);
      const {data, error} = await db
        .from('tournaments')
        .select(
          `${TOURNAMENT_COLUMNS}, form_field_defs(${FORM_FIELD_DEF_COLUMNS})` as const,
        )
        .eq('id', c.req.valid('param').id)
        .order('display_order', {
          referencedTable: 'form_field_defs',
          ascending: true,
        })
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
      return c.json(
        TournamentDetailSchema.parse({
          tournament: rowToTournament(data),
          customName: data.name,
          formFieldDefs: data.form_field_defs.map(toFormFieldDef),
        }),
      );
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
        .insert(toTournamentInsert(c.req.valid('json')))
        .select(TOURNAMENT_COLUMNS)
        .single();
      if (error) {
        const {body, status} = mapPgError(
          error,
          TOURNAMENT_WRITE_ERRORS,
          'failed to create the tournament',
        );
        return c.json(body, status);
      }
      return c.json(rowToTournament(data), 201);
    },
  )
  .patch(
    '/:id',
    requireGeneralStaff(),
    zValidator('param', IdParamSchema),
    zValidator('json', TournamentUpdateInputSchema),
    async c => {
      const db = createDbClient(c.env);
      const {id} = c.req.valid('param');
      const input = c.req.valid('json');
      const {data, error} = await db
        .from('tournaments')
        .update(toTournamentUpdate(input))
        .eq('id', id)
        .select(TOURNAMENT_COLUMNS)
        .single();
      if (error) {
        // `.single()` found no matching row to update. Its message is about
        // the query shape, so it's replaced with the same wording the reads
        // above use for a missing tournament.
        const {body, status} = mapPgError(
          error,
          {
            ...TOURNAMENT_WRITE_ERRORS,
            [NO_ROW_PGRST_CODE]: noRow('tournament not found'),
          },
          'failed to update the tournament',
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
    zValidator('param', IdParamSchema),
    async c => {
      const db = createDbClient(c.env);
      const {data, error} = await db
        .from('tournaments')
        .delete()
        .eq('id', c.req.valid('param').id)
        .select('id');
      if (error) {
        const {body, status} = mapPgError(
          error,
          {
            // `entries.tournament_id` still points here.
            [FOREIGN_KEY_VIOLATION_SQLSTATE]: stillReferenced(
              TOURNAMENT_HAS_ENTRIES_MESSAGE,
            ),
          },
          'failed to delete the tournament',
        );
        return c.json(body, status);
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
    zValidator('param', IdParamSchema),
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
        const {body, status} = mapPgError(
          error,
          {
            [ENTRY_PERIOD_OPEN_SQLSTATE]: {
              status: 409,
              error: 'エントリー期間中の大会はリセットできません',
            },
          },
          'failed to reset the tournament entries',
        );
        return c.json(body, status);
      }
      const [row] = data ?? [];
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
