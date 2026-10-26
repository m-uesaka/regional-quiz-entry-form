import {PageQuerySchema} from '@regional-quiz/shared';

/**
 * The list offset a page's `?offset=` names, for passing on to a paginated
 * backend list.
 *
 * Anything the backend's `PageQuerySchema` would refuse -- a negative,
 * fractional or non-numeric value from a hand-edited URL -- falls back to
 * the first page rather than letting the backend's 400 surface as a
 * failed page load.
 * @param searchParams The page URL's query.
 */
export function readPageOffset(searchParams: URLSearchParams): number {
  const parsed = PageQuerySchema.shape.offset.safeParse(
    searchParams.get('offset') ?? undefined,
  );
  return parsed.success ? parsed.data : 0;
}

/**
 * The URL query for another page of the current list: `query` with its
 * `offset` replaced, and dropped altogether for the first page so that
 * page keeps its plain URL.
 * @param query The current page URL's query, kept for its filters.
 * @param offset The offset of the page to link to.
 */
export function pageQuery(query: URLSearchParams, offset: number): string {
  const next = new URLSearchParams(query);
  if (offset > 0) {
    next.set('offset', String(offset));
  } else {
    next.delete('offset');
  }
  const search = next.toString();
  return search === '' ? '?' : `?${search}`;
}
