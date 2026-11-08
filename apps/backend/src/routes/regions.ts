import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {
  RegionCreateInputSchema,
  RegionUpdateInputSchema,
  type Region,
  type RegionCreateInput,
  type RegionUpdateInput,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {
  createDbClient,
  type Tables,
  type TablesInsert,
  type TablesUpdate,
} from '../lib/db';
import {internalError} from '../lib/errors';
import {
  DUAL_ENTRY_SHARED_QUESTION_SET_MESSAGE,
  DUAL_ENTRY_SHARED_QUESTION_SET_SQLSTATE,
  duplicate,
  mapPgError,
  NO_ROW_PGRST_CODE,
  noRow,
  UNIQUE_VIOLATION_SQLSTATE,
} from '../lib/pg-errors';
import {IdParamSchema} from './params';

/** Shape of a `regions` row as returned by Supabase. */
type RegionRow = Pick<
  Tables<'regions'>,
  'id' | 'slug' | 'name' | 'allows_dual_entry'
>;

/** The columns of `RegionRow`, for every select in this file. */
const REGION_COLUMNS = 'id, slug, name, allows_dual_entry';

// Rows are mapped rather than re-parsed with `RegionSchema`: the slug rules
// live in the create schema, not in the column, so a row written before this
// API existed (or straight through Supabase) may not satisfy them — and a
// read that rejects data already in the table would answer 500 for a region
// the staff can otherwise use fine.
function rowToRegion(row: RegionRow): Region {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    allowsDualEntry: row.allows_dual_entry,
  };
}

/**
 * Turns a create body into the columns Supabase writes. Every column is
 * listed, so the return type checks that each one an insert requires is set.
 * @param input The validated create body.
 */
function toRegionInsert(input: RegionCreateInput): TablesInsert<'regions'> {
  return {
    slug: input.slug,
    name: input.name,
    allows_dual_entry: input.allowsDualEntry,
  };
}

/**
 * Turns a PATCH body into the columns Supabase writes. Only
 * `allowsDualEntry` needs renaming, and every field the caller omitted is
 * left out of the row, so a PATCH updates exactly what it sent. The update
 * schema refuses a body that would leave nothing at all.
 * @param input The validated update body.
 */
function toRegionUpdate(input: RegionUpdateInput): TablesUpdate<'regions'> {
  const {allowsDualEntry, ...rest} = input;
  return allowsDualEntry === undefined
    ? rest
    : {...rest, allows_dual_entry: allowsDualEntry};
}

// The whole app is general-staff only and is mounted alone at `/regions`, so
// the guard can be a wildcard here — unlike `routes/tournaments.ts`, which
// shares its mount path with public routes.
export const regionsRoute = new Hono<StaffEnv>()
  .use('*', requireGeneralStaff())
  .get('/', async c => {
    const db = createDbClient(c.env);
    const {data, error} = await db
      .from('regions')
      .select(REGION_COLUMNS)
      .order('name', {ascending: true});
    if (error) {
      return c.json(internalError('failed to read the regions', error), 500);
    }
    return c.json(data.map(rowToRegion));
  })
  .post('/', zValidator('json', RegionCreateInputSchema), async c => {
    const db = createDbClient(c.env);
    const {data, error} = await db
      .from('regions')
      .insert(toRegionInsert(c.req.valid('json')))
      .select(REGION_COLUMNS)
      .single();
    if (error) {
      // A unique violation here can only be the `slug` column. A slug
      // already in use is an input mistake the staff can fix themselves, so
      // it gets a 409 they can act on rather than a 500.
      //
      // Nothing else here is caller-fixable: the body is already validated,
      // `name` is a plain `text` column and `regions` has no foreign keys, so
      // the remaining failures are Supabase being unreachable or rejecting
      // our key. Those belong in the Worker log as a 500, not in the response
      // as a 400 the admin UI would render as a form error.
      const {body, status} = mapPgError(
        error,
        {[UNIQUE_VIOLATION_SQLSTATE]: duplicate('slug already in use')},
        'failed to create the region',
      );
      return c.json(body, status);
    }
    return c.json(rowToRegion(data), 201);
  })
  .patch(
    '/:id',
    zValidator('param', IdParamSchema),
    zValidator('json', RegionUpdateInputSchema),
    async c => {
      const db = createDbClient(c.env);
      const {data, error} = await db
        .from('regions')
        .update(toRegionUpdate(c.req.valid('json')))
        .eq('id', c.req.valid('param').id)
        .select(REGION_COLUMNS)
        .single();
      if (error) {
        // `.single()` found no row to update. Its message talks about the
        // query shape rather than the region, so it is replaced -- the same
        // translation `routes/tournaments.ts` does. Allowing dual entry where
        // both tournaments share a question set (0045) is the staff's to
        // fix, so it is answered in the words the admin screen shows.
        // Everything else is server-side, for the same reason as in the
        // create handler.
        const {body, status} = mapPgError(
          error,
          {
            [NO_ROW_PGRST_CODE]: noRow('region not found'),
            [DUAL_ENTRY_SHARED_QUESTION_SET_SQLSTATE]: {
              status: 409,
              error: DUAL_ENTRY_SHARED_QUESTION_SET_MESSAGE,
            },
          },
          'failed to update the region',
        );
        return c.json(body, status);
      }
      return c.json(rowToRegion(data));
    },
  );
