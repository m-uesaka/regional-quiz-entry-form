import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '../types/database';
import type {Bindings} from '../types/env';

/**
 * The Supabase client every backend module talks to the database through,
 * typed against the schema generated from `supabase/migrations` (see
 * `bun run db:types`).
 */
export type DbClient = SupabaseClient<Database>;

/**
 * Creates a Supabase client bound to the given Worker environment.
 *
 * Cloudflare Workers is not a Node.js runtime, so we rely on
 * `@supabase/supabase-js`'s fetch-based client rather than a
 * Node-specific driver.
 * @param env The Worker bindings containing the Supabase URL and
 *     secret key.
 */
export function createDbClient(env: Bindings): DbClient {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
    },
  });
}
