import {hc} from 'hono/client';
import type {AppType} from '@regional-quiz/backend';
import {COMMON_ERROR_CODES} from '@regional-quiz/shared';

/**
 * Creates a type-safe RPC client for the backend Hono API.
 *
 * @param fetchImpl The `fetch` implementation to use. Pass SvelteKit's
 *     `event.fetch` from a `load` function so that requests are correctly
 *     proxied/credentialed during server-side rendering.
 */
export function createApiClient(fetchImpl: typeof fetch = fetch) {
  return hc<AppType>('/', {fetch: fetchImpl});
}

/**
 * Whether a backend answer is the 401 an expired staff session earns.
 *
 * Hono builds the RPC client's response union out of what the route handlers
 * themselves return, so the 401 the `requireGeneralStaff()` middleware
 * answers with never appears in it — and `res.status === 401` on one of
 * those routes is a comparison TypeScript rejects as impossible. The status
 * is widened here, once, rather than asserted at every call site.
 *
 * @param res The backend response.
 */
export function isUnauthorized(res: {status: number}): boolean {
  return res.status === 401;
}

/**
 * Whether a backend answer is the 404 an id naming no tournament earns.
 *
 * Widened for the same reason as {@link isUnauthorized}: the 404 comes from
 * the `requireOpenEntryPeriodOrStaff()` middleware rather than the route
 * handler, so it is absent from the status union Hono builds the RPC
 * client's response type out of.
 *
 * @param res The backend response.
 */
export function isNotFound(res: {status: number}): boolean {
  return res.status === 404;
}

/**
 * The `error` strings that are only a code, worded nowhere: a body that
 * failed the route's schema, and a path no route answers (#294). Until the
 * backend answered these in the `{error: string}` shape they were a
 * `ZodError` object and plain text, which {@link readErrorMessage} could not
 * read either, so they still leave its fallback to speak.
 */
const UNWORDED_ERROR_CODES: ReadonlySet<string> = new Set([
  COMMON_ERROR_CODES.INVALID_REQUEST,
  COMMON_ERROR_CODES.NOT_FOUND,
]);

/**
 * Whether an `error` string from the backend can be shown as it is, rather
 * than being a bare code meant for the program (see `UNWORDED_ERROR_CODES`).
 *
 * @param error The `error` string of the response.
 */
export function isShowableError(error: string): boolean {
  return !UNWORDED_ERROR_CODES.has(error);
}

/**
 * Reads the `{error: string}` body the backend answers a refusal with.
 *
 * @param res The failed API response.
 * @param fallback What to answer when the body names no error, e.g. a
 *     non-JSON proxy error page, or names one that is only a code (a body
 *     the route's schema refused).
 */
export async function readErrorMessage(
  res: {json(): Promise<unknown>},
  fallback: string,
): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string' &&
      isShowableError(body.error)
    ) {
      return body.error;
    }
  } catch {
    // A non-JSON body (a proxy error page, say) leaves the fallback to
    // speak for itself.
  }
  return fallback;
}

/** What each way a backend refusal can be told apart is shown as. */
export interface ApiErrorMessages {
  /** Wording by the `error` string, which decides first. */
  byCode?: Readonly<Record<string, string>>;
  /** Wording by status, for an `error` string `byCode` doesn't know. */
  byStatus?: Readonly<Record<number, string>>;
  /** What a refusal neither table knows is shown as. */
  fallback: string;
}

/**
 * What a refusal is shown as: its `error` string's wording, or its status's,
 * or the fallback. The code comes first because one status can stand for
 * several refusals (403 is both "entry period closed" and "entry is
 * cancelled"). For a caller that needs the code too, which it can only read
 * once; anything else wants {@link resolveApiErrorMessage}.
 *
 * @param code The `error` string of the response.
 * @param status The response's status.
 * @param messages The wording to choose from.
 */
export function pickApiErrorMessage(
  code: string,
  status: number,
  {byCode = {}, byStatus = {}, fallback}: ApiErrorMessages,
): string {
  // The code comes over the wire, so an inherited name like `constructor`
  // must not find anything.
  return Object.hasOwn(byCode, code)
    ? byCode[code]
    : (byStatus[status] ?? fallback);
}

/**
 * Reads a refusal and answers with what it is shown as. See
 * {@link pickApiErrorMessage}. For an `error` string meant to be shown as it
 * is, use {@link readErrorMessage}.
 *
 * @param res The failed API response.
 * @param messages The wording to choose from.
 */
export async function resolveApiErrorMessage(
  res: {status: number; json(): Promise<unknown>},
  messages: ApiErrorMessages,
): Promise<string> {
  return pickApiErrorMessage(
    await readErrorMessage(res, ''),
    res.status,
    messages,
  );
}
