// Filler for the bindings Task 11-1 added, for the tests of everything
// else. Every test that hands a route or a `lib/` function an environment
// builds a `Bindings` literal, and five of those fields (a Turnstile secret
// and four rate limiters) have nothing to do with what most of those tests
// are about — but leaving them out no longer typechecks, and leaving the
// limiters undefined makes the middleware throw. They are spread in from
// here instead, so a fourth binding is one edit rather than twenty-three.
//
// Not imported by `src/index.ts`, so none of this reaches the deployed
// Worker: `wrangler deploy` bundles from that entry point outwards.

import type {Bindings} from '../types/env';

/** A limiter that lets everything through, i.e. one that isn't the subject. */
export function allowingRateLimiter(): RateLimit {
  return {limit: () => Promise.resolve({success: true})};
}

/** A limiter that refuses everything, for the tests that are about 429s. */
export function refusingRateLimiter(): RateLimit {
  return {limit: () => Promise.resolve({success: false})};
}

/**
 * The security bindings, filled so that they never interfere: nothing is
 * rate limited, and the Turnstile secret is a placeholder (no test lets a
 * real siteverify call leave the process -- see `turnstileAwareFetch`).
 */
export const PERMISSIVE_SECURITY_BINDINGS: Pick<
  Bindings,
  | 'TURNSTILE_SECRET_KEY'
  | 'LOGIN_IP_RATE_LIMITER'
  | 'LOGIN_EMAIL_RATE_LIMITER'
  | 'MAIL_TRIGGER_IP_RATE_LIMITER'
  | 'MAIL_TRIGGER_EMAIL_RATE_LIMITER'
> = {
  TURNSTILE_SECRET_KEY: 'dummy-turnstile-secret',
  LOGIN_IP_RATE_LIMITER: allowingRateLimiter(),
  LOGIN_EMAIL_RATE_LIMITER: allowingRateLimiter(),
  MAIL_TRIGGER_IP_RATE_LIMITER: allowingRateLimiter(),
  MAIL_TRIGGER_EMAIL_RATE_LIMITER: allowingRateLimiter(),
};

/** A token for the endpoints behind `requireTurnstile()` to be given. */
export const TURNSTILE_TEST_TOKEN = 'dummy-turnstile-token';

/**
 * Answers Turnstile's siteverify with `success`, and everything else with
 * `fetchImpl`.
 *
 * The tests of the endpoints behind `requireTurnstile()` stub `fetch` to
 * stand in for Supabase, and that stub would otherwise answer the siteverify
 * call too -- with a body that says nothing about `success`, which
 * `verifyTurnstile` correctly reads as "not verified" and which would then
 * be the reason every one of those tests passed or failed.
 *
 * @param fetchImpl The stub for everything that isn't siteverify.
 * @param verified What siteverify should say about the token.
 */
export function turnstileAwareFetch(
  fetchImpl: typeof fetch,
  verified = true,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('challenges.cloudflare.com')) {
      return Promise.resolve(Response.json({success: verified}));
    }
    return fetchImpl(input as RequestInfo, init);
  }) as unknown as typeof fetch;
}
