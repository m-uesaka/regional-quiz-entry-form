import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  ENTRY_STATUS_LABELS,
  EntrySchema,
  StaffEntryDetailSchema,
  type CustomFieldValues,
  type Entry,
  type EntryStatus,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {
  requireStaffForEntry,
  requireStaffForTournament,
} from '../middleware/staff-auth';
import {createDbClient} from '../lib/db';
import {
  FORM_FIELD_DEF_COLUMNS,
  toFormFieldDef,
  type FormFieldDefRow,
} from '../lib/form-field-defs';
import {buildEntriesCsv} from '../lib/entries-csv';
import {fetchAllRows, type AllRowsResult} from '../lib/paged-select';
import {internalError} from '../lib/errors';

const TournamentIdParamSchema = z.object({tournamentId: z.string().uuid()});
const EntryIdParamSchema = z.object({entryId: z.string().uuid()});

const ENTRY_COLUMNS =
  'id, tournament_id, name, furigana, display_name, regulation_id, ' +
  'free_text, custom_field_values, status, waitlist_position, ' +
  'participants(email), regulations(label)';

const ENTRY_CSV_COLUMNS =
  'name, furigana, display_name, custom_field_values, status';

/** Shape of an `entries` row as selected for the CSV export. */
interface EntryCsvRow {
  name: string;
  furigana: string;
  display_name: string;
  custom_field_values: CustomFieldValues;
  status: EntryStatus;
}

// Excel on Windows reads a BOM-less file as the system's legacy encoding,
// which turns every Japanese cell into mojibake, so the export is served
// with a UTF-8 BOM.
const UTF8_BOM = '\uFEFF';

/**
 * Fetches every entry of a tournament in the shape the CSV export needs.
 * @param db The Supabase client to query with.
 * @param tournamentId The tournament whose entries are exported.
 */
function fetchAllEntryCsvRows(
  db: ReturnType<typeof createDbClient>,
  tournamentId: string,
): Promise<AllRowsResult<EntryCsvRow>> {
  return fetchAllRows<EntryCsvRow>((from, to) =>
    db
      .from('entries')
      .select(ENTRY_CSV_COLUMNS)
      .eq('tournament_id', tournamentId)
      .order('created_at', {ascending: true})
      .order('id', {ascending: true})
      .range(from, to)
      .returns<EntryCsvRow[]>(),
  );
}

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
      const {tournamentId} = c.req.valid('param');
      const {rows, error} = await fetchAllRows<EntryRow>((from, to) =>
        db
          .from('entries')
          .select(ENTRY_COLUMNS)
          .eq('tournament_id', tournamentId)
          .order('created_at', {ascending: true})
          .order('id', {ascending: true})
          .range(from, to)
          .returns<EntryRow[]>(),
      );
      if (error) {
        return c.json(internalError('failed to read the entries', error), 500);
      }
      return c.json(rows.map(rowToEntry));
    },
  )
  .get(
    '/tournaments/:tournamentId/entries.csv',
    zValidator('param', TournamentIdParamSchema),
    requireStaffForTournament(),
    async c => {
      const {tournamentId} = c.req.valid('param');
      const db = createDbClient(c.env);
      const {rows: entryRows, error} = await fetchAllEntryCsvRows(
        db,
        tournamentId,
      );
      if (error) {
        return c.json(
          internalError('failed to read the entries for the CSV', error),
          500,
        );
      }

      // The tournament's custom form fields become the CSV's trailing
      // columns, headed by their `label` in `display_order` — the raw
      // `custom_field_values` keys would be meaningless to staff.
      const {data: formFieldDefRows, error: formFieldDefsError} = await db
        .from('form_field_defs')
        .select(FORM_FIELD_DEF_COLUMNS)
        .eq('tournament_id', tournamentId)
        .order('display_order', {ascending: true})
        .returns<FormFieldDefRow[]>();
      if (formFieldDefsError) {
        return c.json(
          internalError(
            'failed to read the form field defs',
            formFieldDefsError,
          ),
          500,
        );
      }

      const csv = buildEntriesCsv(
        (formFieldDefRows ?? []).map(toFormFieldDef),
        entryRows.map(row => ({
          name: row.name,
          furigana: row.furigana,
          displayName: row.display_name,
          status: ENTRY_STATUS_LABELS[row.status],
          customFieldValues: row.custom_field_values,
        })),
      );

      return c.body(UTF8_BOM + csv, 200, {
        'Content-Type': 'text/csv; charset=utf-8',
        // The tournament id keeps downloads for different tournaments from
        // collapsing into `entries.csv`, `entries (1).csv`, ... and stays
        // ASCII, unlike the tournament name.
        'Content-Disposition': `attachment; filename="entries-${tournamentId}.csv"`,
      });
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
        return c.json(internalError('failed to read the entry', error), 500);
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
        .select(FORM_FIELD_DEF_COLUMNS)
        .eq('tournament_id', data.tournament_id)
        .order('display_order', {ascending: true})
        .returns<FormFieldDefRow[]>();
      if (formFieldDefsError) {
        return c.json(
          internalError(
            'failed to read the form field defs',
            formFieldDefsError,
          ),
          500,
        );
      }

      return c.json(
        StaffEntryDetailSchema.parse({
          ...rowToEntry(data),
          formFieldDefs: (formFieldDefRows ?? []).map(toFormFieldDef),
        }),
      );
    },
  );
