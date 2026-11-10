import type {
  CommonErrorCode,
  CustomFieldValuesErrorMessage,
  EntryErrorCode,
  EntryEditErrorCode,
} from '@regional-quiz/shared';
import type {Context} from 'hono';
import {HTTPException} from 'hono/http-exception';

/** The body every unexpected server-side failure answers with. */
const INTERNAL_ERROR_BODY = {error: 'internal server error'} as const;

/**
 * Logs an unexpected failure and returns the body to answer it with.
 *
 * Raw Supabase messages describe the database rather than anything the
 * caller can act on, and several of these endpoints are reachable without
 * a session, so the message belongs in the Worker's log and not in the
 * response. Client-caused failures (a constraint the staff UI can report,
 * a malformed YAML upload) keep their own messages — this is only for the
 * 500s.
 * @param context What was being attempted, for the log line.
 * @param cause The underlying error.
 */
export function internalError(
  context: string,
  cause: unknown,
): {error: string} {
  console.error(context, cause);
  return {...INTERNAL_ERROR_BODY};
}

/** The statuses a lib function can refuse a client with. */
export type ClientFailureStatus = 400 | 401 | 403 | 404 | 409;

/**
 * What a client may be told a refusal was. The frontend picks its wording by
 * these strings (#191, #195). The codes are fixed, and a custom field
 * rejection is a fixed prefix followed by the field's key, so a database
 * message only gets into a 4xx if code puts it after one of those prefixes.
 * The type can't rule that out, so take those messages from
 * `findCustomFieldValuesError()` and don't write them by hand.
 */
export type ClientFailureCode =
  | EntryErrorCode
  | CommonErrorCode
  | EntryEditErrorCode
  | CustomFieldValuesErrorMessage;

/** A lib function refusing the client, in the client's own terms. */
export interface ClientFailure<S extends ClientFailureStatus> {
  ok: false;
  status: S;
  error: ClientFailureCode;
}

/**
 * An unexpected failure -- one nothing can be done about, a database outage
 * or a row the code did not expect -- thrown for `app.onError` (`index.ts`)
 * to log and answer with `internalError()`'s 500. It is not a refusal, so it
 * is not in a lib function's result type.
 *
 * `context` is what was being attempted, for the log line; `cause` is the
 * underlying error (a Supabase error, say), logged beside it. Neither is
 * ever sent to the client. The message holds both, for a place that can only
 * log a message (`createEntryUnauthenticated()`).
 */
export class UnexpectedFailure extends Error {
  constructor(
    readonly context: string,
    readonly cause: unknown,
  ) {
    const detail =
      typeof cause === 'object' &&
      cause !== null &&
      'message' in cause &&
      typeof cause.message === 'string'
        ? cause.message
        : undefined;
    super(detail === undefined ? context : `${context}: ${detail}`);
    this.name = 'UnexpectedFailure';
  }
}

/**
 * The data of a query that must have worked: a failure is thrown as an
 * `UnexpectedFailure`, which `app.onError` answers with a 500.
 *
 * A failure the caller can name (a constraint violation it answers with a
 * 409, say) is the caller's to check for first, e.g. with `mapPgError()`;
 * this is for what is left.
 * @param result What supabase-js resolved the query to: the data, or the
 *     error (its `data` is `null` then).
 * @param context What was being attempted, for the log line.
 * @return The data.
 */
export function unwrap<R extends {data: unknown; error: unknown}>(
  result: R,
  context: string,
): Extract<R, {error: null}>['data'] {
  if (result.error) {
    throw new UnexpectedFailure(context, result.error);
  }
  return result.data;
}

/**
 * The app's `onError` (#294, #378): what answers when a handler throws.
 *
 * An `HTTPException` is a refusal some middleware chose on purpose -- the
 * origin check's 403 -- so it keeps the response it carries, as Hono's
 * default handler would give it. Anything else thrown is a fault on our side,
 * logged and answered with a 500 whose body is the same whatever it was. An
 * `UnexpectedFailure` brings its own context and the underlying error to the
 * log; any other error (a `XSchema.parse()` meeting a database value it did
 * not expect, say) is logged as it is, under the request it broke.
 * @param err What was thrown.
 * @param c The request's context.
 */
export function handleError(err: Error, c: Context) {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  if (err instanceof UnexpectedFailure) {
    return c.json(internalError(err.context, err.cause), 500);
  }
  return c.json(internalError(`${c.req.method} ${c.req.path}`, err), 500);
}

/**
 * Answers a lib function's refusal with its code and status.
 * @param c The request's context.
 * @param failure The refusal.
 * @template S The statuses `failure` refuses a client with.
 */
export function respondFailure<S extends ClientFailureStatus>(
  c: Context,
  failure: ClientFailure<S>,
) {
  return c.json({error: failure.error}, failure.status);
}
