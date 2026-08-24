import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  EntrySchema,
  StaffEntryDetailSchema,
  type Entry,
  type EntryStatus,
} from '@regional-quiz/shared';
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
  'free_text, custom_field_values, status, waitlist_position, ' +
  'participants(email), regulations(label)';

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
  participants: {email: string} | null;
  regulations: {label: string} | null;
}

/** Shape of a `form_field_defs` row as selected below (snake_case). */
interface FormFieldDefRow {
  field_key: string;
  label: string;
  field_type: string;
  options: string[] | null;
  display_order: number;
}

// Not typed as `FormFieldDef` here: `field_type` is a plain `string` at the
// database boundary, and `StaffEntryDetailSchema.parse()` (below, mirroring
// `rowToEntry()`'s use of `EntrySchema.parse()`) is what actually validates
// and narrows it to the `FormFieldType` enum at runtime.
function toFormFieldDef(row: FormFieldDefRow) {
  return {
    fieldKey: row.field_key,
    label: row.label,
    fieldType: row.field_type,
    options: row.options,
    displayOrder: row.display_order,
  };
}

function rowToEntry(row: EntryRow): Entry {
  return EntrySchema.parse({
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    furigana: row.furigana,
    displayName: row.display_name,
    email: row.participants?.email,
    regulationId: row.regulation_id,
    regulationLabel: row.regulations?.label,
    freeText: row.free_text,
    customFieldValues: row.custom_field_values,
    status: row.status,
    waitlistPosition: row.waitlist_position,
  });
}

export const staffEntriesRoute = new Hono<StaffEnv>()
  .get(
    '/tournaments/:tournamentId/entries',
    zValidator('param', TournamentIdParamSchema),
    requireStaffForTournament(),
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
    zValidator('param', EntryIdParamSchema),
    requireStaffForEntry(),
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

      // The ordered custom form field definitions for the entry's
      // tournament, so the staff UI can render each `customFieldValues`
      // entry under its human-readable label instead of the raw storage
      // key.
      const {data: formFieldDefRows, error: formFieldDefsError} = await db
        .from('form_field_defs')
        .select('field_key, label, field_type, options, display_order')
        .eq('tournament_id', data.tournament_id)
        .order('display_order', {ascending: true})
        .returns<FormFieldDefRow[]>();
      if (formFieldDefsError) {
        return c.json({error: formFieldDefsError.message}, 500);
      }

      return c.json(
        StaffEntryDetailSchema.parse({
          ...rowToEntry(data),
          formFieldDefs: (formFieldDefRows ?? []).map(toFormFieldDef),
        }),
      );
    },
  );
