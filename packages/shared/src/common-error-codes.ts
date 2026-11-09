/**
 * The `error` strings several pages' APIs answer with, kept apart from
 * `ENTRY_ERROR_CODES` so the entry form's set holds only what the entry form
 * can be answered with. Like those, the values are the wire format: rename a
 * key, never a value.
 */
export const COMMON_ERROR_CODES = {
  /**
   * No usable session: none was sent, it has expired, or the account it was
   * issued to is gone. Staff and participant sessions alike.
   */
  UNAUTHORIZED: 'unauthorized',
  /**
   * Not an entry the caller may see, said the same for one of someone else's
   * as for one that doesn't exist.
   */
  ENTRY_NOT_FOUND: 'entry not found',
  /**
   * A mailed link that can't be used: the entry verification's or either
   * password reset's.
   */
  INVALID_OR_EXPIRED_TOKEN: 'invalid or expired token',
  /**
   * A request whose path parameters, query or body fail the route's schema,
   * whichever route it is (#294). The issues are not sent: the frontend runs
   * the same schemas from this package before it calls the API, so it has
   * its own field messages already.
   */
  INVALID_REQUEST: 'invalid request',
  /** A path no route is mounted at (#294). */
  NOT_FOUND: 'not found',
} as const;

/** One of the `error` strings in `COMMON_ERROR_CODES`. */
export type CommonErrorCode =
  (typeof COMMON_ERROR_CODES)[keyof typeof COMMON_ERROR_CODES];
