import {error} from '@sveltejs/kit';
import {EntrySchema} from '@regional-quiz/shared';

/**
 * The schema of the id a route param names: the `id` field of the shared
 * schema of what it names (`TournamentSchema.shape.id`, ...), so the page
 * checks the id the same way the backend's param schema does.
 */
export interface IdSchema {
  safeParse(value: unknown): {success: boolean};
}

/** How `parseRouteId` checks an id and words its refusal. */
export interface RouteIdOptions {
  /** The schema the id has to pass. */
  schema: IdSchema;
  /** What an id failing it is shown as, with status 404. */
  notFoundMessage: string;
}

/**
 * Checks that a route's id param can name anything at all. An id the schema
 * refuses (one that isn't a UUID) names nothing, and is answered here as
 * "not found" rather than sent on to come back as the API's 400 -- which
 * the page would then have to tell apart from any other request the API
 * refused, and would otherwise show as a 502.
 *
 * Called before any request the page sends, so a malformed id asks the API
 * nothing.
 * @param id The route param.
 * @param options The schema to check it with, and the 404's wording.
 * @return The id, unchanged.
 */
export function parseRouteId(
  id: string,
  {schema, notFoundMessage}: RouteIdOptions,
): string {
  if (!schema.safeParse(id).success) {
    error(404, notFoundMessage);
  }
  return id;
}

/**
 * Checks a route's `[entryId]`, the way the backend's `EntryIdParamSchema`
 * does: one that isn't a UUID is 404「エントリーが見つかりません」.
 * @param entryId The route param.
 * @return The id, unchanged.
 */
export function parseEntryId(entryId: string): string {
  return parseRouteId(entryId, {
    schema: EntrySchema.shape.id,
    notFoundMessage: 'エントリーが見つかりません',
  });
}
