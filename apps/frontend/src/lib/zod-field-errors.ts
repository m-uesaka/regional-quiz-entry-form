import type {FieldErrors} from '$lib/types/form-errors';

/**
 * The part of a `ZodError` this module reads. Typed structurally so the
 * frontend needn't depend on `zod` itself just to name the error the shared
 * schemas raise.
 */
interface FlattenableError {
  flatten(): {fieldErrors: FieldErrors};
}

/**
 * A rejected schema's messages, keyed by the top-level field each issue is
 * about, as `ZodError.flatten().fieldErrors` keys them. Issues about the
 * value as a whole (an empty path) are left out, as `flatten()` leaves them
 * out of `fieldErrors`.
 * @param error The `error` of a failed `safeParse()`.
 */
export function zodFieldErrors(error: FlattenableError): FieldErrors {
  return error.flatten().fieldErrors;
}
