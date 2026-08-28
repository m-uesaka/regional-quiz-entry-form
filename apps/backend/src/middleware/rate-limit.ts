import type {Context, Input, MiddlewareHandler} from 'hono';
import {createMiddleware} from 'hono/factory';
import type {Bindings, Env} from '../types/env';

/**
 * Refuses a request once the given rate limiter says the key is over its
 * budget, answering 429 with a `Retry-After`.
 *
 * Lockout (stop an account after N failures) is deliberately not what this
 * does. Only the number of attempts per unit of time is capped, and never
 * the account itself: nothing here counts failures, so a refusal always
 * expires on its own.
 *
 * A limit keyed on an email address is still a lever for keeping the owner
 * of that address refused -- an attacker who knows it only has to keep the
 * bucket full -- so the endpoints that use one put it on a limiter whose
 * budget is far too loose for a legitimate caller to ever meet, and pay for
 * that with a weaker cap on guessing against a single account. The tight
 * numbers are all on IP keys, where the caller being refused is the one
 * spending the budget. See `wrangler.toml`.
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
 *     collide on one bucket -- and, where two endpoints share a limiter but
 *     must not share a bucket, name the endpoint too (see the email keys in
 *     `routes/participant-auth.ts` and `routes/staff-auth.ts`).
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
 * The part of a rate-limit key that names an email address.
 *
 * Case-folded, because `Victim@example.com` and `victim@example.com` are two
 * strings for one mailbox. Counted as submitted they land in two buckets, so
 * the per-address cap an endpoint advertises could be had over again for
 * every capitalization a caller cares to try -- which on the endpoints that
 * send mail is the whole of what the cap is for.
 *
 * @param email The address the request named, as it was submitted.
 */
export function emailKey(email: string): string {
  return `email:${email.toLowerCase()}`;
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
