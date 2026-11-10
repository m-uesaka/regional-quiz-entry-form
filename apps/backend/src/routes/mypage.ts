import {Hono} from 'hono';
import {
  COMMON_ERROR_CODES,
  EntryEditInputSchema,
  MypageEntryDetailSchema,
  MypageEntrySchema,
  type MypageEntry,
} from '@regional-quiz/shared';
import type {ParticipantEnv} from '../types/env';
import {requireParticipant} from '../middleware/participant-auth';
import {type Tables} from '../lib/db';
import {cancelOwnEntry, updateOwnEntry} from '../lib/own-entries';
import {respondFailure, unwrap} from '../lib/errors';
import {tournamentDisplayName} from '../lib/tournaments';
import {fetchFormFieldDefs} from '../lib/form-field-defs';
import {
  ENTRY_REGULATIONS_COLUMNS,
  entryRegulationLabels,
} from '../lib/entry-regulations';
import {EntryIdParamSchema} from './params';
import {validate} from '../middleware/validate';

const LIST_COLUMNS = `
  id, tournament_id, status, waitlist_position,
  tournaments(name, type, region_id, entry_opens_at, entry_closes_at,
  regions(slug, name))
`;

const DETAIL_COLUMNS = `${LIST_COLUMNS},
  name, furigana, display_name, free_text, custom_field_values,
  ${ENTRY_REGULATIONS_COLUMNS}
` as const;

/** Shape of an `entries` row as selected by `LIST_COLUMNS` (snake_case). */
interface MypageEntryRow extends Pick<
  Tables<'entries'>,
  'id' | 'tournament_id' | 'status' | 'waitlist_position'
> {
  tournaments: Pick<
    Tables<'tournaments'>,
    'name' | 'type' | 'region_id' | 'entry_opens_at' | 'entry_closes_at'
  > & {regions: Pick<Tables<'regions'>, 'slug' | 'name'>};
}

function rowToMypageEntry(row: MypageEntryRow): MypageEntry {
  return MypageEntrySchema.parse({
    id: row.id,
    tournamentId: row.tournament_id,
    status: row.status,
    waitlistPosition: row.waitlist_position,
    tournament: {
      name: tournamentDisplayName(
        row.tournaments.name,
        row.tournaments.regions.name,
        row.tournaments.type,
      ),
      type: row.tournaments.type,
      regionId: row.tournaments.region_id,
      regionSlug: row.tournaments.regions.slug,
      entryOpensAt: row.tournaments.entry_opens_at,
      entryClosesAt: row.tournaments.entry_closes_at,
    },
  });
}

export const mypageRoute = new Hono<ParticipantEnv>()
  .use('*', requireParticipant())
  .get('/entries', async c => {
    const db = c.get('db');
    const data = unwrap(
      await db
        .from('entries')
        .select(LIST_COLUMNS)
        .eq('participant_id', c.get('participantId')),
      'failed to read the own entries',
    );
    return c.json(data.map(rowToMypageEntry));
  })
  .get('/entries/:entryId', validate('param', EntryIdParamSchema), async c => {
    const db = c.get('db');
    // Scoped to the session's participant so another participant's entry
    // is indistinguishable from a nonexistent one.
    const data = unwrap(
      await db
        .from('entries')
        .select(DETAIL_COLUMNS)
        .eq('id', c.req.valid('param').entryId)
        .eq('participant_id', c.get('participantId'))
        .maybeSingle(),
      'failed to read the own entry',
    );
    if (!data) {
      return c.json({error: COMMON_ERROR_CODES.ENTRY_NOT_FOUND}, 404);
    }

    // The tournament's custom form fields, so the edit screen can
    // re-render the same form the entry was submitted through.
    const fieldDefs = await fetchFormFieldDefs(db, data.tournament_id);

    return c.json(
      MypageEntryDetailSchema.parse({
        ...rowToMypageEntry(data),
        name: data.name,
        furigana: data.furigana,
        displayName: data.display_name,
        regulationLabels: entryRegulationLabels(data.entry_regulations),
        freeText: data.free_text,
        customFieldValues: data.custom_field_values,
        formFieldDefs: fieldDefs,
      }),
    );
  })
  .patch(
    '/entries/:entryId',
    validate('param', EntryIdParamSchema),
    validate('json', EntryEditInputSchema),
    async c => {
      const result = await updateOwnEntry(
        c.get('db'),
        c.get('participantId'),
        c.req.valid('param').entryId,
        c.req.valid('json'),
      );
      if (!result.ok) {
        return respondFailure(c, result);
      }
      return c.json({ok: true});
    },
  )
  .delete(
    '/entries/:entryId',
    validate('param', EntryIdParamSchema),
    async c => {
      const result = await cancelOwnEntry(
        c.env,
        c.get('db'),
        c.get('participantId'),
        c.req.valid('param').entryId,
      );
      if (!result.ok) {
        return respondFailure(c, result);
      }
      return c.json({ok: true});
    },
  );
