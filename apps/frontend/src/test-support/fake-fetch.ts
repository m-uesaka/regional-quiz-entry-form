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

/**
 * One row of a fake `fetch`'s response table. A request is answered by the
 * first row whose `method` and `url` both match it; a row that leaves one
 * out matches any.
 */
export interface FakeRoute {
  method?: string;
  /** Contained in the request URL (a string), or tested on it (a RegExp). */
  url?: string | RegExp;
  /** The status to answer with, 200 unless given. */
  status?: number;
  /** The JSON body to answer with; without one the response has none. */
  body?: unknown;
  /**
   * Builds the answer instead of `status` / `body`, for one that depends on
   * the request or isn't plain JSON. Throwing makes the `fetch` reject, as
   * a network error would.
   */
  respond?: (request: FakeRequest) => Response | Promise<Response>;
}

/**
 * Builds a fake `fetch` that answers each request from a response table, so
 * a test only spells out the endpoints its page talks to. A request no row
 * matches rejects, naming it.
 * @param routes The response table, first match wins.
 * @param requests Collects every request sent, in order.
 */
export function fakeFetch(
  routes: readonly FakeRoute[],
  requests?: RecordedRequest[],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = await readRequest(input, init);
    requests?.push({
      method: request.method,
      url: request.url,
      body: request.body,
    });
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
 * forms the caller used.
 */
async function readRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<FakeRequest> {
  if (input instanceof Request) {
    const text = await input.clone().text();
    return {
      method: input.method,
      url: input.url,
      body: text === '' ? undefined : parseBody(text),
      headers: input.headers,
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
