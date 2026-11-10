import {createMiddleware} from 'hono/factory';
import {createDbClient} from '../lib/db';
import type {Env} from '../types/env';

/**
 * Makes the request's Supabase client, once, and leaves it on the context as
 * `db` for the middleware, the handler and the `lib/` functions behind it.
 *
 * Made per request rather than kept per Worker isolate: a client holds an
 * auth ticker and the `fetch` it was made with, and neither is meant to be
 * shared across the requests of an isolate (the `env` object is, which is
 * why a cache keyed on it would outlive them). The Queue consumer, which has
 * no context, makes its own once per invocation (`handleBulkMailQueue()`).
 */
export function dbClient() {
  return createMiddleware<Env>((c, next) => {
    c.set('db', createDbClient(c.env));
    return next();
  });
}
