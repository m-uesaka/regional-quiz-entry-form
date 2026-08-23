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
 * Replaces all `form_field_defs` rows for a tournament with the fields
 * parsed from a form definition YAML document.
 *
 * This deletes every existing row for the tournament and bulk-inserts the
 * new set, which has the same net effect as an update/insert/delete diff
 * (existing `field_key`s reappear via delete+reinsert, new ones are
 * inserted, and ones no longer present in the YAML are removed) since no
 * other table references `form_field_defs.id` by foreign key.
 * @param env The Worker bindings containing the Supabase connection info.
 * @param tournamentId The tournament the fields belong to.
 * @param definition The parsed form definition YAML.
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

  const deleteResult = await db
    .from('form_field_defs')
    .delete()
    .eq('tournament_id', tournamentId);
  if (deleteResult.error) {
    throw new Error(deleteResult.error.message);
  }

  if (rows.length > 0) {
    const insertResult = await db.from('form_field_defs').insert(rows);
    if (insertResult.error) {
      throw new Error(insertResult.error.message);
    }
  }
}
