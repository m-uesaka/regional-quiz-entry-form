import {Hono} from 'hono';
import {zValidator} from '@hono/zod-validator';
import {z} from 'zod';
import {
  RegionCreateInputSchema,
  RegionUpdateInputSchema,
  type Region,
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
}

// Rows are mapped rather than re-parsed with `RegionSchema`: the slug rules
// live in the create schema, not in the column, so a row written before this
// API existed (or straight through Supabase) may not satisfy them — and a
// read that rejects data already in the table would answer 500 for a region
// the staff can otherwise use fine.
function rowToRegion(row: RegionRow): Region {
  return {id: row.id, slug: row.slug, name: row.name};
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
      .select('id, slug, name')
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
      .insert(c.req.valid('json'))
      .select('id, slug, name')
      .returns<RegionRow[]>()
      .single();
    if (error) {
      // 23505 is a unique violation, which here can only be the `slug`
      // column. A slug already in use is an input mistake the staff can fix
      // themselves, so it gets a 409 they can act on rather than a 500.
      if (error.code === '23505') {
        return c.json({error: 'slug already in use'}, 409);
      }
      return c.json({error: error.message}, 400);
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
        .update(c.req.valid('json'))
        .eq('id', c.req.valid('param').id)
        .select('id, slug, name')
        .returns<RegionRow[]>()
        .single();
      if (error) {
        // PGRST116: `.single()` found no row to update. Its message talks
        // about the query shape rather than the region, so it is replaced —
        // the same translation `routes/tournaments.ts` does.
        if (error.code === 'PGRST116') {
          return c.json({error: 'region not found'}, 404);
        }
        return c.json({error: error.message}, 400);
      }
      return c.json(rowToRegion(data));
    },
  );
