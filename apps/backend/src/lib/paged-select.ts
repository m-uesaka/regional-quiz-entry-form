// Supabase's Data API caps a single response at `max_rows` rows
// (`supabase/config.toml`), and it does so silently: a query matching more
// rows than the cap comes back truncated rather than failing. Any query
// whose result set can grow past that cap has to page through `range()`
// instead of selecting everything at once.

/** Rows requested per `range()` batch, below the Data API's row cap. */
export const SELECT_PAGE_SIZE = 500;

/** Either every matching row, or the error that stopped the paging. */
export type AllRowsResult<T> =
  {rows: T[]; error: null} | {rows: null; error: {message: string}};

/**
 * Collects every row a query matches by requesting it in `range()` batches.
 *
 * The query built by `selectPage` must impose a deterministic total order —
 * where the sort column is not unique (`created_at` is not), a tie-breaker
 * on a unique column such as `id` is required, or rows can be skipped or
 * repeated across page boundaries.
 * @param selectPage Builds the query for one batch, given the inclusive
 *     row offsets to pass to `range()`.
 * @param pageSize Rows to request per batch.
 */
export async function fetchAllRows<T>(
  selectPage: (
    from: number,
    to: number,
  ) => PromiseLike<{data: T[] | null; error: {message: string} | null}>,
  pageSize = SELECT_PAGE_SIZE,
): Promise<AllRowsResult<T>> {
  const rows: T[] = [];
  for (;;) {
    const {data, error} = await selectPage(
      rows.length,
      rows.length + pageSize - 1,
    );
    if (error) {
      return {rows: null, error};
    }
    const batch = data ?? [];
    rows.push(...batch);
    // Only an empty batch ends the paging. A short-but-non-empty one is
    // ambiguous: the range may have run past the last row, but the server
    // may equally have trimmed it down to its own `max_rows`, and stopping
    // there would drop rows exactly like the unpaginated query this
    // replaces. Since the next offset is however many rows are already
    // collected, a trimmed page only makes the loop take smaller steps.
    if (batch.length === 0) {
      return {rows, error: null};
    }
  }
}
