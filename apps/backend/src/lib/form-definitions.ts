import {
  toFormFieldDefRows,
  type FormDefinitionYaml,
} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';

/**
 * Maps the camelCase `form_field_defs` rows produced by
 * `toFormFieldDefRows()` to the snake_case columns the table actually has.
 */
function toFormFieldDefTableRow(
  row: ReturnType<typeof toFormFieldDefRows>[number],
): Record<string, unknown> {
  return {
    tournament_id: row.tournamentId,
    field_key: row.fieldKey,
    label: row.label,
    field_type: row.fieldType,
    required: row.required,
    options: row.options,
    display_order: row.displayOrder,
  };
}

/**
 * The SQLSTATE the `sync_form_field_defs` Postgres function raises (see
 * `supabase/migrations/0002_sync_form_field_defs_fn.sql`) when the given
 * tournament doesn't exist.
 */
const TOURNAMENT_NOT_FOUND_SQLSTATE = 'P0002';

/** Thrown by `syncFormFieldDefs()` when `tournamentId` doesn't exist. */
export class TournamentNotFoundError extends Error {
  constructor(tournamentId: string) {
    super(`tournament not found: ${tournamentId}`);
    this.name = 'TournamentNotFoundError';
  }
}

/**
 * Replaces all `form_field_defs` rows for a tournament with the fields
 * parsed from a form definition YAML document.
 *
 * This delegates to the `sync_form_field_defs` Postgres function, which
 * deletes every existing row for the tournament and bulk-inserts the new
 * set inside a single transaction (same net effect as an update/insert/
 * delete diff, since no other table references `form_field_defs.id` by
 * foreign key) and locks the tournament row for the duration, so concurrent
 * uploads for the same tournament can't interleave and produce a merged
 * field set.
 * @param env The Worker bindings containing the Supabase connection info.
 * @param tournamentId The tournament the fields belong to.
 * @param definition The parsed form definition YAML.
 * @throws {TournamentNotFoundError} If `tournamentId` doesn't exist.
 */
export async function syncFormFieldDefs(
  env: Bindings,
  tournamentId: string,
  definition: FormDefinitionYaml,
): Promise<void> {
  const db = createDbClient(env);
  const rows = toFormFieldDefRows(definition, tournamentId).map(
    toFormFieldDefTableRow,
  );

  const {error} = await db.rpc('sync_form_field_defs', {
    p_tournament_id: tournamentId,
    p_rows: rows,
  });
  if (error) {
    if (error.code === TOURNAMENT_NOT_FOUND_SQLSTATE) {
      throw new TournamentNotFoundError(tournamentId);
    }
    throw new Error(error.message);
  }
}
