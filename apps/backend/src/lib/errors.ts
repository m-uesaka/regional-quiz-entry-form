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
