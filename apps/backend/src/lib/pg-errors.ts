import {type ClientFailureStatus, internalError} from './errors';

// The codes a Postgres or PostgREST failure can carry that this backend
// tells apart, gathered here so each is defined once (#199).
//
// Postgres' own SQLSTATEs mean the same thing wherever they come from. The
// custom ones (`P0002`...) don't: each Postgres function picks its own, and
// the same number means one thing in one function and another in the next.
// So each custom code has one constant per meaning, named for that meaning
// and for the functions that raise it, and a caller compares against the
// constant for the function it called -- never against another function's
// constant that happens to hold the same number. Renumbering them would
// take a migration for every function, which isn't worth it.

/**
 * Postgres' `unique_violation`: the row clashes with one already there --
 * a slug or address in use, or a concurrent request that inserted first.
 */
export const UNIQUE_VIOLATION_SQLSTATE = '23505';

/**
 * Postgres' `foreign_key_violation`. On an insert or update it means the row
 * names one that doesn't exist; on a delete, that rows still point at the one
 * being deleted. Which of the two it is depends on the statement, so a
 * caller answers it with `missingReference()` or `stillReferenced()`.
 */
export const FOREIGN_KEY_VIOLATION_SQLSTATE = '23503';

/** PostgREST's code for a `.single()` that matched no row. */
export const NO_ROW_PGRST_CODE = 'PGRST116';

/** PostgREST's code for a `range()` whose offset is past the last row. */
export const RANGE_NOT_SATISFIABLE_PGRST_CODE = 'PGRST103';

/**
 * Raised by the tournament-scoped functions `sync_form_field_defs()` (0002)
 * and `sync_regulations()` (0014, 0018, 0042) when the tournament they were
 * called for doesn't exist.
 */
export const TOURNAMENT_NOT_FOUND_SQLSTATE = 'P0002';

/**
 * Raised by `disable_staff_account()` and `enable_staff_account()` (0027)
 * when the account doesn't exist.
 */
export const STAFF_ACCOUNT_NOT_FOUND_SQLSTATE = 'P0002';

/**
 * Raised by the functions that redeem a one-time token --
 * `confirm_entry_by_token()` (0003, 0008, 0034),
 * `reset_participant_password()` (0009, 0010, 0011) and
 * `reset_staff_password()` (0015, 0020, 0026) -- when the token is unknown,
 * already used or expired, or (for `confirm_entry_by_token()`) the entry is
 * no longer awaiting verification.
 */
export const INVALID_TOKEN_SQLSTATE = 'P0003';

/**
 * Raised by `sync_regulations()` when a regulation `id` in the request isn't
 * one of the tournament's. The ids travel in the exception's `detail`.
 */
export const UNKNOWN_REGULATION_SQLSTATE = 'P0003';

/**
 * Raised by `reorder_tournaments()` (0032) when the ids it is given aren't
 * exactly the tournaments there are.
 */
export const TOURNAMENT_IDS_MISMATCH_SQLSTATE = 'P0003';

/**
 * Raised by `sync_regulations()` when a regulation the request drops is
 * still chosen by an entry. The labels travel in the exception's `detail`.
 */
export const REGULATION_IN_USE_SQLSTATE = 'P0004';

/**
 * Raised by `disable_staff_account()` (0026, 0027) when disabling the
 * account would leave no general staff account enabled.
 */
export const LAST_GENERAL_STAFF_SQLSTATE = 'P0004';

/**
 * Raised by `check_entry_seat()` (0041) for a second seat in a region that
 * allows only one. That trigger is the only place the rule of
 * `regions.allows_dual_entry` lives.
 */
export const REGION_DUAL_ENTRY_SQLSTATE = 'P0005';

/**
 * Raised by `issue_staff_password_link()` (0027) and
 * `add_staff_password_link()` (0031) when the account is disabled (#156).
 */
export const STAFF_ACCOUNT_DISABLED_SQLSTATE = 'P0005';

/**
 * Raised by `import_tournament()` (0036) when the tournament has been
 * created (for `create`) or deleted (for `overwrite`) since the preview.
 */
export const IMPORT_ACTION_STALE_SQLSTATE = 'P0006';

/**
 * Raised by `reset_tournament_entries()` (0038) when the tournament's entry
 * period is open, so nothing was deleted.
 */
export const ENTRY_PERIOD_OPEN_SQLSTATE = 'P0007';

/**
 * Raised by `check_entry_seat()` (0040, 0041) for a seat outside the
 * participant's region: a concurrent submission moved the participant to
 * another region after this one last looked.
 */
export const PARTICIPANT_REGION_SQLSTATE = 'P0008';

/**
 * Raised by `sync_regulations()` (0042) when every regulation would be
 * marked to close once saved.
 */
export const NO_LASTING_REGULATION_SQLSTATE = 'P0009';

/**
 * Raised by the triggers of 0045 when a region allowing dual entry would
 * have its 最強位 and 新人王 on the same question set: one tournament's
 * questions would be seen by those entered in the other.
 */
export const DUAL_ENTRY_SHARED_QUESTION_SET_SQLSTATE = 'P0010';

/**
 * What a tournament or region write refused with
 * `DUAL_ENTRY_SHARED_QUESTION_SET_SQLSTATE` is answered with: shown as it is
 * above the admin form.
 */
export const DUAL_ENTRY_SHARED_QUESTION_SET_MESSAGE =
  '重複エントリーを認める地域では、最強位と新人王に同じ問題セットを設定できません';

/**
 * How a route answers one Postgres failure it can name.
 *
 * `error` is either a fixed code the frontend picks its own wording by, or a
 * staff-facing Japanese message the staff screen shows verbatim -- never the
 * database's own message, which names tables and constraints (#122).
 * @template S The status it is answered with.
 */
export interface PgErrorAnswer<S extends ClientFailureStatus> {
  readonly status: S;
  readonly error: string;
}

/**
 * The failures a route can name, keyed by the code they carry.
 *
 * One kind of violation is answered with one status on every route, and the
 * type holds the entries for Postgres' and PostgREST's own codes to it: an
 * entry for one of them with any other status does not compile. Build those
 * entries with the functions below. A foreign key violation can be either
 * of two answers, depending on the statement (see
 * `FOREIGN_KEY_VIOLATION_SQLSTATE`).
 * @template S The statuses the route answers them with.
 */
export type PgErrorTable<S extends ClientFailureStatus> = Readonly<
  Record<string, PgErrorAnswer<S>> & {
    [UNIQUE_VIOLATION_SQLSTATE]?: PgErrorAnswer<409>;
    [FOREIGN_KEY_VIOLATION_SQLSTATE]?: PgErrorAnswer<400 | 409>;
    [NO_ROW_PGRST_CODE]?: PgErrorAnswer<404>;
  }
>;

/**
 * The answer to a unique violation (`23505`): the request clashes with what
 * is already stored, so it can't go through as it stands -- 409.
 * @param error The code or staff-facing message to answer with.
 */
export function duplicate(error: string): PgErrorAnswer<409> {
  return {status: 409, error};
}

/**
 * The answer to a foreign key violation (`23503`) on an insert or update:
 * the request names a row that doesn't exist, which is a mistake in the
 * request itself -- 400, like any other invalid input.
 * @param error The code or staff-facing message to answer with.
 */
export function missingReference(error: string): PgErrorAnswer<400> {
  return {status: 400, error};
}

/**
 * The answer to a foreign key violation (`23503`) on a delete: other rows
 * still point at the one being deleted, so the request conflicts with what is
 * stored -- 409.
 * @param error The code or staff-facing message to answer with.
 */
export function stillReferenced(error: string): PgErrorAnswer<409> {
  return {status: 409, error};
}

/**
 * The answer to PostgREST's `PGRST116` on a `.single()` update: the row
 * the request names doesn't exist -- 404.
 * @param error The code or staff-facing message to answer with.
 */
export function noRow(error: string): PgErrorAnswer<404> {
  return {status: 404, error};
}

/**
 * Turns a failure supabase-js returned into the route's response: the entry
 * of `table` for its code, or -- for anything the route can't name --
 * `internalError()`'s body with a 500, logging the failure.
 *
 * Returned rather than answered, so that the route's `c.json(body, status)`
 * keeps the statuses `hc<AppType>()` reads.
 * @param error The error supabase-js returned.
 * @param table The failures the route can name.
 * @param context What was being attempted, for the log line of a 500.
 * @template S The statuses `table` answers with.
 */
export function mapPgError<S extends ClientFailureStatus>(
  error: {code?: string},
  table: PgErrorTable<S>,
  context: string,
): {body: {error: string}; status: S | 500} {
  const answer =
    error.code !== undefined && Object.hasOwn(table, error.code)
      ? table[error.code]
      : undefined;
  if (answer !== undefined) {
    return {body: {error: answer.error}, status: answer.status};
  }
  return {body: internalError(context, error), status: 500};
}
