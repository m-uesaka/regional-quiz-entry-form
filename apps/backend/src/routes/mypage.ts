import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  EntryEditInputSchema,
  MypageEntryDetailSchema,
  MypageEntrySchema,
  type MypageEntry,
} from '@regional-quiz/shared';
import type {ParticipantEnv} from '../types/env';
import {requireParticipant} from '../middleware/participant-auth';
import {createDbClient} from '../lib/db';
import {cancelOwnEntry, updateOwnEntry} from '../lib/entries';
import {
  FORM_FIELD_DEF_COLUMNS,
  toFormFieldDef,
  type FormFieldDefRow,
} from '../lib/form-field-defs';

const EntryIdParamSchema = z.object({entryId: z.string().uuid()});

const LIST_COLUMNS =
  'id, tournament_id, status, waitlist_position, ' +
  'tournaments(name, type, region_id, entry_opens_at, entry_closes_at)';

const DETAIL_COLUMNS =
  LIST_COLUMNS +
  ', name, furigana, display_name, free_text, custom_field_values, ' +
  'regulations(label)';

/** Shape of an `entries` row as selected by `LIST_COLUMNS` (snake_case). */
interface MypageEntryRow {
  id: string;
  tournament_id: string;
  status: MypageEntry['status'];
  waitlist_position: number | null;
  tournaments: {
    name: string;
    type: MypageEntry['tournament']['type'];
    region_id: string;
    entry_opens_at: string;
    entry_closes_at: string;
  };
}

/** Shape of the single-entry row selected by `DETAIL_COLUMNS`. */
interface MypageEntryDetailRow extends MypageEntryRow {
  name: string;
  furigana: string;
  display_name: string;
  free_text: string | null;
  custom_field_values: Record<string, string | string[]>;
  regulations: {label: string} | null;
}

function rowToMypageEntry(row: MypageEntryRow): MypageEntry {
  return MypageEntrySchema.parse({
    id: row.id,
    tournamentId: row.tournament_id,
    status: row.status,
    waitlistPosition: row.waitlist_position,
    tournament: {
      name: row.tournaments.name,
      type: row.tournaments.type,
      regionId: row.tournaments.region_id,
      entryOpensAt: row.tournaments.entry_opens_at,
      entryClosesAt: row.tournaments.entry_closes_at,
    },
  });
}

export const mypageRoute = new Hono<ParticipantEnv>()
  .use('*', requireParticipant())
  .get('/entries', async c => {
    const db = createDbClient(c.env);
    const {data, error} = await db
      .from('entries')
      .select(LIST_COLUMNS)
      .eq('participant_id', c.get('participantId'))
      .returns<MypageEntryRow[]>();
    if (error) {
      return c.json({error: error.message}, 500);
    }
    return c.json((data ?? []).map(rowToMypageEntry));
  })
  .get(
    '/entries/:entryId',
    zValidator('param', EntryIdParamSchema),
    async c => {
      const db = createDbClient(c.env);
      // Scoped to the session's participant so another participant's entry
      // is indistinguishable from a nonexistent one.
      const {data, error} = await db
        .from('entries')
        .select(DETAIL_COLUMNS)
        .eq('id', c.req.valid('param').entryId)
        .eq('participant_id', c.get('participantId'))
        .returns<MypageEntryDetailRow[]>()
        .maybeSingle();
      if (error) {
        return c.json({error: error.message}, 500);
      }
      if (!data) {
        return c.json({error: 'entry not found'}, 404);
      }

      // The tournament's custom form fields, so the edit screen can
      // re-render the same form the entry was submitted through.
      const {data: formFieldDefRows, error: formFieldDefsError} = await db
        .from('form_field_defs')
        .select(FORM_FIELD_DEF_COLUMNS)
        .eq('tournament_id', data.tournament_id)
        .order('display_order', {ascending: true})
        .returns<FormFieldDefRow[]>();
      if (formFieldDefsError) {
        return c.json({error: formFieldDefsError.message}, 500);
      }

      return c.json(
        MypageEntryDetailSchema.parse({
          ...rowToMypageEntry(data),
          name: data.name,
          furigana: data.furigana,
          displayName: data.display_name,
          regulationLabel: data.regulations?.label,
          freeText: data.free_text,
          customFieldValues: data.custom_field_values,
          formFieldDefs: (formFieldDefRows ?? []).map(toFormFieldDef),
        }),
      );
    },
  )
  .patch(
    '/entries/:entryId',
    zValidator('param', EntryIdParamSchema),
    zValidator('json', EntryEditInputSchema),
    async c => {
      const result = await updateOwnEntry(
        c.env,
        c.get('participantId'),
        c.req.valid('param').entryId,
        c.req.valid('json'),
      );
      if (!result.ok) {
        return c.json({error: result.error}, result.status);
      }
      return c.json({ok: true});
    },
  )
  .delete(
    '/entries/:entryId',
    zValidator('param', EntryIdParamSchema),
    async c => {
      const result = await cancelOwnEntry(
        c.env,
        c.get('participantId'),
        c.req.valid('param').entryId,
      );
      if (!result.ok) {
        return c.json({error: result.error}, result.status);
      }
      return c.json({ok: true});
    },
  );
