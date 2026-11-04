import {jsonResponse} from './json-response';

/** One request a fake `fetch` was sent, in the shape tests assert on. */
export interface RecordedRequest {
  method: string;
  /**
   * The URL as the caller passed it. The RPC client is built on `/`, so for
   * a call through it this is the relative path and query, e.g.
   * `/api/regions`.
   */
  url: string;
  /** The body parsed as JSON (kept as text if it isn't), if one was sent. */
  body: unknown;
}

/** What a route's `respond` sees: the request, headers included. */
export interface FakeRequest extends RecordedRequest {
  headers: Headers;
}

/** Which requests a route answers: a row that leaves one out matches any. */
interface FakeRouteMatch {
  method?: string;
  /**
   * Contained in the request URL (a string), or tested on it (a RegExp
   * without the `g` or `y` flag, which would make it match only every other
   * time).
   */
  url?: string | RegExp;
}

/** A route answering with a fixed JSON body (or none). */
interface FakeJsonRoute extends FakeRouteMatch {
  /** The status to answer with, 200 unless given. */
  status?: number;
  /**
   * The JSON body to answer with; without one the response has none. A
   * status that can't carry a body (204, 205, 304) can't be given one.
   */
  body?: unknown;
  respond?: never;
}

/** A route building its answer from the request. */
interface FakeRespondRoute extends FakeRouteMatch {
  /**
   * Builds the answer, for one that depends on the request or isn't plain
   * JSON. Throwing makes the `fetch` reject, as a network error would.
   */
  respond: (request: FakeRequest) => Response | Promise<Response>;
  status?: never;
  body?: never;
}

/**
 * One row of a fake `fetch`'s response table. A request is answered by the
 * first row whose `method` and `url` both match it. A row answers either
 * with `status` / `body` or with `respond`, never both.
 */
export type FakeRoute = FakeJsonRoute | FakeRespondRoute;

/** Statuses a `Response` must not have a body with. */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

/**
 * Refuses a table that could only fail inside the fake, where the failure
 * would read as a network error and send the page down the wrong branch.
 */
function checkRoutes(routes: readonly FakeRoute[]) {
  for (const route of routes) {
    if (route.url instanceof RegExp && (route.url.global || route.url.sticky)) {
      throw new Error(
        `fake route ${route.url}: a g or y flag keeps state between requests`,
      );
    }
    if (
      route.body !== undefined &&
      NULL_BODY_STATUSES.has(route.status ?? 200)
    ) {
      throw new Error(`fake route: status ${route.status} can't have a body`);
    }
  }
}

/**
 * Builds a fake `fetch` that answers each request from a response table, so
 * a test only spells out the endpoints its page talks to. A request no row
 * matches rejects, naming it -- so a table only catches a page calling an
 * endpoint it shouldn't if every row names its method and URL.
 * @param routes The response table, first match wins.
 * @param requests Collects every request sent, in order.
 * @param requestsWithHeaders Collects every request sent, in order, with its
 *     headers, for a test that asserts on one (`requests` leaves them out so
 *     that it can be compared whole).
 */
export function fakeFetch(
  routes: readonly FakeRoute[],
  requests?: RecordedRequest[],
  requestsWithHeaders?: FakeRequest[],
): typeof fetch {
  checkRoutes(routes);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = await readRequest(input, init);
    requests?.push({
      method: request.method,
      url: request.url,
      body: request.body,
    });
    requestsWithHeaders?.push(request);
    const route = routes.find(
      candidate =>
        (candidate.method === undefined ||
          candidate.method === request.method) &&
        matchesUrl(candidate.url, request.url),
    );
    if (!route) {
      throw new Error(`unexpected request: ${request.method} ${request.url}`);
    }
    if (route.respond) {
      return route.respond(request);
    }
    const status = route.status ?? 200;
    return route.body === undefined
      ? new Response(null, {status})
      : jsonResponse(route.body, status);
  }) as typeof fetch;
}

function matchesUrl(pattern: string | RegExp | undefined, url: string) {
  if (pattern === undefined) return true;
  return typeof pattern === 'string'
    ? url.includes(pattern)
    : pattern.test(url);
}

/**
 * Reads what a `fetch` call was asked to send, whichever of its argument
 * forms the caller used. A `Request` is combined with `init` the way `fetch`
 * combines them, and its URL -- absolute, as a `Request` requires -- is
 * recorded as its path and query, like the relative URLs the RPC client
 * passes.
 */
async function readRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<FakeRequest> {
  if (input instanceof Request) {
    const merged = new Request(input, init);
    const text = await merged.clone().text();
    const url = new URL(merged.url);
    return {
      method: merged.method,
      url: url.pathname + url.search,
      body: text === '' ? undefined : parseBody(text),
      headers: merged.headers,
    };
  }
  return {
    method: init?.method ?? 'GET',
    url: typeof input === 'string' ? input : input.href,
    body:
      init?.body === undefined || init.body === null
        ? undefined
        : parseBody(init.body),
    headers: new Headers(init?.headers),
  };
}

function parseBody(body: BodyInit): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}
