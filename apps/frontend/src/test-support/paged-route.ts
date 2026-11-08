import type {FakeRoute} from './fake-fetch';
import {jsonResponse} from './json-response';

/** The page size the backend answers a paged list with by default. */
const PAGE_SIZE = 100;

/**
 * Builds a fake `fetch` row answering a `GET` of a paged list the way the
 * backend does: `{items, total, limit, offset}`, echoing the `offset` the
 * request asked for (0 if it asked for none).
 * @param url The list's path, matched as a `FakeRoute` URL is.
 * @param items The items the page holds, the same for every offset.
 * @param options.total The total to report, the number of items unless
 *     given.
 * @param options.status The status to answer with, 200 unless given.
 */
export function pagedRoute(
  url: string | RegExp,
  items: readonly unknown[],
  options: {total?: number; status?: number} = {},
): FakeRoute {
  return {
    method: 'GET',
    url,
    respond: request => {
      const offset = new URL(request.url, 'http://localhost').searchParams.get(
        'offset',
      );
      return jsonResponse(
        {
          items,
          total: options.total ?? items.length,
          limit: PAGE_SIZE,
          offset: Number(offset ?? 0),
        },
        options.status ?? 200,
      );
    },
  };
}
