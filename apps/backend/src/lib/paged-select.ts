// Supabase's Data API caps a single response at `max_rows` rows
// (`supabase/config.toml`), and it does so silently: a query matching more
// rows than the cap comes back truncated rather than failing. Any query
// whose result set can grow past that cap has to page through `range()`
// instead of selecting everything at once.

/**
 * Rows requested per `range()` batch. Must stay strictly below the Data
 * API's `max_rows` (`supabase/config.toml`): `fetchAllRows()` ends on the
 * first short batch, which is only safe while the server never trims one.
 */
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
 * @param pageSize Rows to request per batch; must be a positive integer.
 * @throws RangeError If `pageSize` is not a positive integer.
 */
export async function fetchAllRows<T>(
  selectPage: (
    from: number,
    to: number,
  ) => PromiseLike<{data: T[] | null; error: {message: string} | null}>,
  pageSize = SELECT_PAGE_SIZE,
): Promise<AllRowsResult<T>> {
  // A page size of 0 asks for the empty range `(0, -1)`, so the first batch
  // comes back empty and the loop reports success with no rows even though
  // the query matches some; a fractional or negative size builds an equally
  // meaningless range. Reject them up front rather than silently dropping
  // rows.
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError(
      `pageSize must be a positive integer, got ${pageSize}`,
    );
  }

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
    // A short batch is ambiguous in general: the range may have run past
    // the last row, or the server may have trimmed it down to its own
    // `max_rows`, and stopping on a trimmed page would drop rows exactly
    // like the unpaginated query this replaces. But as long as the page
    // size stays below `max_rows` in `supabase/config.toml`, trimming
    // cannot happen, so a short batch is the last one and the paging ends
    // without asking for the empty page after it.
    // `paged-select.test.ts` pins that precondition by reading config.toml.
    if (batch.length < pageSize) {
      return {rows, error: null};
    }
  }
}

/** PostgREST's code for a `range()` whose offset is past the last row. */
const RANGE_NOT_SATISFIABLE = 'PGRST103';

/** Either one page of rows and the total row count, or the error. */
export type PageResult<T> =
  | {rows: T[]; total: number; error: null}
  | {rows: null; total: null; error: {message: string}};

/**
 * Fetches one page of a query together with the total number of rows it
 * matches, in a single request.
 *
 * The query built by `selectPage` must be selected with `{count: 'exact'}`
 * (that is what puts the total in the response) and impose the same
 * deterministic total order `fetchAllRows()` requires, or rows can be
 * skipped or repeated across pages.
 * @param selectPage Builds the query for the page, given the inclusive row
 *     offsets to pass to `range()`.
 * @param page The page to fetch.
 * @param page.limit Rows per page; at most `SELECT_PAGE_SIZE`, so the
 *     server's `max_rows` cannot trim the page.
 * @param page.offset Rows to skip.
 */
export async function fetchPage<T>(
  selectPage: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    count: number | null;
    error: {message: string; code?: string} | null;
  }>,
  page: {limit: number; offset: number},
): Promise<PageResult<T>> {
  const {limit, offset} = page;
  const {data, count, error} = await selectPage(offset, offset + limit - 1);
  if (error) {
    if (error.code !== RANGE_NOT_SATISFIABLE) {
      return {rows: null, total: null, error};
    }
    // With an exact count, PostgREST refuses an offset past the last row
    // with 416 instead of an empty page. That is a stale or hand-edited
    // pager link, not a failure: answer it as the empty page it asks for,
    // with the total from a one-row probe so the pager can still lead back.
    const probe = await selectPage(0, 0);
    if (probe.error) {
      return {rows: null, total: null, error: probe.error};
    }
    return {rows: [], total: probe.count ?? 0, error: null};
  }
  const rows = data ?? [];
  // `count` only goes missing if the query was built without
  // `{count: 'exact'}`; the rows seen so far are then the best lower bound.
  return {rows, total: count ?? offset + rows.length, error: null};
}
