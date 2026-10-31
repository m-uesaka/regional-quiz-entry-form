import type {
  CustomFieldValuesErrorMessage,
  EntryErrorCode,
  EntryNotEditableCode,
} from '@regional-quiz/shared';
import type {Context} from 'hono';

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
 * What a client may be told a refusal was. Every member is fixed by the code
 * or built from fixed parts, so a database message has no way into a 4xx: the
 * frontend picks its wording by these strings (#191, #195).
 */
export type ClientFailureCode =
  EntryErrorCode | EntryNotEditableCode | CustomFieldValuesErrorMessage;

/** A lib function refusing the client, in the client's own terms. */
export interface ClientFailure<S extends ClientFailureStatus> {
  ok: false;
  status: S;
  error: ClientFailureCode;
}

/**
 * A fault on our side. `error` is free text for the log -- a database or
 * thrown message -- and `respondFailure()` never sends it. Anything a lib
 * function can't name as a refusal is one of these.
 */
export interface InternalFailure {
  ok: false;
  status: 500;
  error: string;
}

/**
 * How a lib function fails.
 * @template S The statuses it can refuse a client with.
 */
export type LibFailure<S extends ClientFailureStatus> =
  ClientFailure<S> | InternalFailure;

/**
 * The result of a lib function whose only failures are on our side.
 * @template T What it gives on success.
 */
export type InternalResult<T> = {ok: true; value: T} | InternalFailure;

/**
 * Answers a lib function's failure: a refusal with its code and status, a
 * fault with `internalError()`'s body.
 *
 * `S` defaults to `never` so that an `InternalFailure` alone adds nothing but
 * the 500 to the route's type, which `hc<AppType>()` reads.
 * @param c The request's context.
 * @param failure The failure.
 * @param context What was being attempted, for the log line of a fault.
 * @template S The statuses `failure` can refuse a client with.
 */
export function respondFailure<S extends ClientFailureStatus = never>(
  c: Context,
  failure: LibFailure<S>,
  context: string,
) {
  if (failure.status === 500) {
    return c.json(internalError(context, failure.error), 500);
  }
  return c.json({error: failure.error}, failure.status);
}
