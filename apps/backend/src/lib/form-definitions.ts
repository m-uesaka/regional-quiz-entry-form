import {
  toFormFieldDefRows,
  TournamentTypeSchema,
  type FormDefinitionYaml,
  type TournamentType,
} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createDbClient} from './db';
import {
  TOURNAMENT_NOT_FOUND_SQLSTATE,
  TournamentNotFoundError,
} from './tournament-errors';

// Re-exported so callers of `syncFormFieldDefs()` can catch it without
// having to know it's shared with the regulation sync.
export {TournamentNotFoundError};

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
 * Thrown by `syncFormFieldDefs()` when the YAML's `tournamentSlug` names a
 * different tournament type than the tournament the upload targets. The
 * message is staff-facing: the upload UI renders the API's `error` string
 * verbatim.
 */
export class TournamentSlugMismatchError extends Error {
  constructor(
    readonly expected: TournamentType,
    readonly actual: TournamentType,
  ) {
    super(
      `YAML の tournamentSlug (${actual}) が保存先の大会の種別 ` +
        `(${expected}) と一致しません`,
    );
    this.name = 'TournamentSlugMismatchError';
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
 *
 * The definition's `tournamentSlug` is checked against the target
 * tournament's `type` *before* the sync runs, so a YAML authored for the
 * other tournament type can't silently wipe out this tournament's existing
 * definitions. This only rules out a type mix-up (e.g. saving a 最強位
 * definition onto 新人王); the slug carries no region, so mixing up two
 * regions' tournaments of the same type still isn't detectable here.
 *
 * The check is a separate read from the sync, so a tournament whose `type`
 * is changed in the narrow window between the two would still be synced.
 * That's accepted: the check exists to catch a staff member uploading the
 * wrong file, not to enforce an invariant against concurrent edits, and the
 * outcome of losing that race is the same as having no check at all.
 * @param env The Worker bindings containing the Supabase connection info.
 * @param tournamentId The tournament the fields belong to.
 * @param definition The parsed form definition YAML.
 * @throws {TournamentNotFoundError} If `tournamentId` doesn't exist.
 * @throws {TournamentSlugMismatchError} If the definition's
 *     `tournamentSlug` doesn't match the tournament's type.
 */
export async function syncFormFieldDefs(
  env: Bindings,
  tournamentId: string,
  definition: FormDefinitionYaml,
): Promise<void> {
  const db = createDbClient(env);

  const {data: tournament, error: tournamentError} = await db
    .from('tournaments')
    .select('type')
    .eq('id', tournamentId)
    .maybeSingle();
  if (tournamentError) {
    throw new Error(tournamentError.message);
  }
  if (!tournament) {
    throw new TournamentNotFoundError(tournamentId);
  }
  // The client is created without generated database types, so the selected
  // row comes back as `any`. Parsing (rather than asserting) keeps the
  // narrowing honest: `tournaments.type` is the `tournament_type` Postgres
  // enum, whose values are exactly the ones `TournamentTypeSchema` accepts
  // (see `supabase/migrations/0001_init.sql`), so this only throws if the
  // database schema and the shared schema have drifted apart.
  const type: TournamentType = TournamentTypeSchema.parse(tournament.type);
  if (type !== definition.tournamentSlug) {
    throw new TournamentSlugMismatchError(type, definition.tournamentSlug);
  }

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
