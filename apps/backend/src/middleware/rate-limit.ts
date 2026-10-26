import type {Context, Input, MiddlewareHandler} from 'hono';
import {createMiddleware} from 'hono/factory';
import {
  CLIENT_IP_FORWARD_SECRET_HEADER,
  CLIENT_IP_HEADER,
} from '@regional-quiz/shared';
import {timingSafeEqual} from '../lib/timing-safe';
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
 * The address the request came from, as the per-IP rate limits count it:
 * an IPv4 address as it is, an IPv6 one cut to its /64 (see
 * `rateLimitAddress()`).
 *
 * Normally that is `CF-Connecting-IP`, which Cloudflare sets on the way in
 * and overwrites whatever the client sent, so it cannot be forged the way
 * `X-Forwarded-For` can.
 *
 * Most of the requests the rate limits exist for do not come from the
 * browser, though. Login, the entry form and the reset requests are form
 * actions, so they reach this Worker as subrequests made by the frontend's
 * SSR (`handleFetch` in `apps/frontend/src/hooks.server.ts`), and the
 * address Cloudflare names for those is the frontend's, not the user's --
 * one bucket for everybody, which one attacker could keep full to lock
 * every user out of logging in (#188). So the frontend forwards the
 * browser's address in `X-Client-IP`, and it is believed only when the
 * request also carries `CLIENT_IP_FORWARD_SECRET`, a secret only the two
 * deployments know. Anybody else can send the header too, and without the
 * secret it is ignored rather than trusted. With the secret unset on this
 * side it is never trusted at all, which is what local development and the
 * tests get unless they opt in.
 *
 * Something has to prove the header came from the frontend, because the
 * frontend reaches this Worker over its public `*.workers.dev` origin
 * (`BACKEND_URL`), the same way anybody else can. A Service Binding would
 * prove it by the route the request took instead, but it only exists on
 * Cloudflare: `vite dev` and the end-to-end run would need a second way of
 * reaching the backend, and the SSR path is the one this is about. A shared
 * secret keeps the single `fetch(BACKEND_URL)` everywhere.
 *
 * `CF-Connecting-IP` is absent only when the Worker is reached without
 * going through Cloudflare's edge -- in practice `wrangler dev` -- where a
 * single shared bucket is the right answer anyway: there is one caller.
 *
 * @param c The request's context.
 */
export function clientIp<I extends Input = Input>(
  c: Context<Env, string, I>,
): string {
  const forwarded = c.req.header(CLIENT_IP_HEADER);
  if (forwarded) {
    const secret = c.env.CLIENT_IP_FORWARD_SECRET;
    if (
      isForwardSecret(c.req.header(CLIENT_IP_FORWARD_SECRET_HEADER), secret)
    ) {
      return rateLimitAddress(forwarded);
    }
    // A mismatch is silent otherwise: the request is simply counted against
    // the frontend's address again, which is the shared bucket #188 is
    // about. A secret registered with a stray newline, rotated on one side
    // only, or not yet picked up by a Pages deploy would then go unnoticed
    // for good, so it is logged. Only when a secret is configured here --
    // without one the header is ignored by design -- and never the value.
    if (secret) {
      console.warn(
        `${CLIENT_IP_HEADER} ignored: ${CLIENT_IP_FORWARD_SECRET_HEADER} ` +
          'is missing or does not match CLIENT_IP_FORWARD_SECRET',
      );
    }
  }
  const connecting = c.req.header('cf-connecting-ip');
  return connecting ? rateLimitAddress(connecting) : 'unknown';
}

/**
 * The part of an address that names one caller for rate limiting.
 *
 * An IPv4 address is one. An IPv6 one isn't: an ordinary connection is
 * handed a whole /64 (2^64 addresses), so keyed on the full address a single
 * caller could take a fresh bucket for every request and never meet the
 * limit. So an IPv6 address is cut to its first four groups, written out in
 * one canonical spelling (`2001:db8:0:1::/64`) so every way of writing the
 * same prefix lands in the same bucket. An IPv4-mapped address
 * (`::ffff:192.0.2.1`) is counted as the IPv4 address it carries. Anything
 * that doesn't parse is kept as it is: it still names *some* bucket, and
 * guessing at it could merge callers that have nothing in common.
 * @param address The address as a header carried it.
 */
export function rateLimitAddress(address: string): string {
  if (!address.includes(':')) return address;
  const groups = expandIpv6(address.toLowerCase());
  if (!groups) return address;
  if (groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff) {
    return `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
  }
  return `${groups
    .slice(0, 4)
    .map(g => g.toString(16))
    .join(':')}::/64`;
}

/**
 * The eight 16-bit groups of an IPv6 address, or null when it isn't one.
 * Accepts `::` and a trailing dotted IPv4 part; a zone (`%eth0`) is dropped.
 * @param address A lower-cased IPv6 address.
 */
function expandIpv6(address: string): number[] | null {
  const [withoutZone] = address.split('%');
  const halves = withoutZone.split('::');
  if (halves.length > 2) return null;
  const parse = (half: string): number[] | null => {
    if (half === '') return [];
    const groups: number[] = [];
    const parts = half.split(':');
    for (const [i, part] of parts.entries()) {
      if (i === parts.length - 1 && part.includes('.')) {
        const octets = part.split('.');
        if (
          octets.length !== 4 ||
          !octets.every(o => /^\d{1,3}$/.test(o) && Number(o) <= 255)
        ) {
          return null;
        }
        const [a, b, c, d] = octets.map(Number);
        groups.push((a << 8) | b, (c << 8) | d);
      } else if (/^[0-9a-f]{1,4}$/.test(part)) {
        groups.push(parseInt(part, 16));
      } else {
        return null;
      }
    }
    return groups;
  };
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/**
 * Whether `presented` is the configured forwarding secret.
 *
 * Compared in constant time (`timingSafeEqual`), so the response time of a
 * login cannot be used to guess the secret a character at a time.
 *
 * @param presented The `X-Client-IP-Forward-Secret` header, if sent.
 * @param expected `CLIENT_IP_FORWARD_SECRET`, if configured. Unset or empty
 *     means no request is trusted, rather than every request that also
 *     sends an empty header.
 */
function isForwardSecret(
  presented: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected || presented === undefined) return false;
  return timingSafeEqual(presented, expected);
}
