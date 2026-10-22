import {createClient} from '@supabase/supabase-js';
import type {Bindings} from '../types/env';

/**
 * Creates a Supabase client bound to the given Worker environment.
 *
 * Cloudflare Workers is not a Node.js runtime, so we rely on
 * `@supabase/supabase-js`'s fetch-based client rather than a
 * Node-specific driver.
 * @param env The Worker bindings containing the Supabase URL and
 *     secret key.
 */
export function createDbClient(env: Bindings) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
    },
  });
}
