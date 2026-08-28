import type {Context, Input, MiddlewareHandler} from 'hono';
import {createMiddleware} from 'hono/factory';
import type {Bindings, Env} from '../types/env';

/**
 * Refuses a request once the given rate limiter says the key is over its
 * budget, answering 429 with a `Retry-After`.
 *
 * Lockout (stop an account after N failures) is deliberately not what this
 * does. Anyone who knows a participant's address could then lock them out
 * of their own entry at will, which trades a brute-force risk for a
 * denial-of-service one; only the number of attempts per unit of time is
 * capped here, and never the account itself.
 *
 * The limiters are Cloudflare's Rate Limiting bindings, so the counting is
 * per-colo and approximate. That is enough for what this defends against
 * (credential stuffing, mail bombing, and the PBKDF2 work an unauthenticated
 * login can make the Worker do) and costs no storage of its own.
 *
 * @param binding Picks the limiter to count against out of the Worker's
 *     bindings.
 * @param keyOf Builds the key to count under. Prefix it with what the key
 *     means (`ip:` / `email:`), so two limits on the same limiter can never
 *     collide on one bucket.
 * @param retryAfterSeconds What to put in `Retry-After`. The binding does
 *     not report when the budget resets, so this is the limiter's own
 *     period, named by the caller.
 */
export function rateLimit<I extends Input = Input>(
  binding: (env: Bindings) => RateLimit,
  keyOf: (c: Context<Env, string, I>) => string,
  retryAfterSeconds: number,
): MiddlewareHandler<Env, string, I> {
  return createMiddleware<Env, string, I>(async (c, next) => {
    const {success} = await binding(c.env).limit({key: keyOf(c)});
    if (!success) {
      return c.json({error: 'too many requests'}, 429, {
        'Retry-After': String(retryAfterSeconds),
      });
    }
    await next();
  });
}

/**
 * The address the request came from, as Cloudflare saw it.
 *
 * `CF-Connecting-IP` is set by Cloudflare on the way in and overwrites
 * whatever the client sent, so it cannot be forged the way `X-Forwarded-For`
 * can. It is absent only when the Worker is reached without going through
 * that edge -- in practice `wrangler dev` -- where a single shared bucket is
 * the right answer anyway: there is one caller.
 *
 * @param c The request's context.
 */
export function clientIp<I extends Input = Input>(
  c: Context<Env, string, I>,
): string {
  return c.req.header('cf-connecting-ip') ?? 'unknown';
}
