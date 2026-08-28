import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  RegionCreateInputSchema,
  RegionUpdateInputSchema,
  type Region,
  type RegionCreateInput,
  type RegionUpdateInput,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {requireGeneralStaff} from '../middleware/staff-auth';
import {createDbClient} from '../lib/db';
import {internalError} from '../lib/errors';

const RegionIdParamSchema = z.object({id: z.string().uuid()});

/** Shape of a `regions` row as returned by Supabase. */
interface RegionRow {
  id: string;
  slug: string;
  name: string;
  allows_dual_entry: boolean;
}

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
 * Turns the API's camelCase input into the columns Supabase writes. Only
 * `allowsDualEntry` needs renaming — `slug` and `name` are spelled the same
 * on both sides — and it is left out when the caller omitted it, so a PATCH
 * that only renames a region keeps its current setting.
 * @param input The validated create or update body.
 */
function toRegionRow(
  input: RegionCreateInput | RegionUpdateInput,
): Record<string, unknown> {
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
      .order('name', {ascending: true})
      .returns<RegionRow[]>();
    if (error) {
      return c.json(internalError('failed to read the regions', error), 500);
    }
    return c.json(data.map(rowToRegion));
  })
  .post('/', zValidator('json', RegionCreateInputSchema), async c => {
    const db = createDbClient(c.env);
    const {data, error} = await db
      .from('regions')
      .insert(toRegionRow(c.req.valid('json')))
      .select(REGION_COLUMNS)
      .returns<RegionRow[]>()
      .single();
    if (error) {
      // 23505 is a unique violation, which here can only be the `slug`
      // column. A slug already in use is an input mistake the staff can fix
      // themselves, so it gets a 409 they can act on rather than a 500.
      //
      // Nothing else here is caller-fixable: the body is already validated,
      // `name` is a plain `text` column and `regions` has no foreign keys, so
      // the remaining failures are Supabase being unreachable or rejecting
      // our key. Those belong in the Worker log as a 500, not in the response
      // as a 400 the admin UI would render as a form error.
      if (error.code === '23505') {
        return c.json({error: 'slug already in use'}, 409);
      }
      return c.json(internalError('failed to create the region', error), 500);
    }
    return c.json(rowToRegion(data), 201);
  })
  .patch(
    '/:id',
    zValidator('param', RegionIdParamSchema),
    zValidator('json', RegionUpdateInputSchema),
    async c => {
      const db = createDbClient(c.env);
      const {data, error} = await db
        .from('regions')
        .update(toRegionRow(c.req.valid('json')))
        .eq('id', c.req.valid('param').id)
        .select(REGION_COLUMNS)
        .returns<RegionRow[]>()
        .single();
      if (error) {
        // PGRST116: `.single()` found no row to update. Its message talks
        // about the query shape rather than the region, so it is replaced —
        // the same translation `routes/tournaments.ts` does. Everything else
        // is server-side, for the same reason as in the create handler.
        if (error.code === 'PGRST116') {
          return c.json({error: 'region not found'}, 404);
        }
        return c.json(internalError('failed to update the region', error), 500);
      }
      return c.json(rowToRegion(data));
    },
  );
