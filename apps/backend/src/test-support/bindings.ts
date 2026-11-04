// Filler for the bindings the app has grown, for the tests of everything
// else. Every test that hands a route or a `lib/` function an environment
// needs a whole `Bindings`, and most of its fields (the secrets, the rate
// limiters, the bulk mail queue) have nothing to do with what most of those
// tests are about -- but leaving them out no longer typechecks, and leaving
// the limiters undefined makes the middleware throw. `testBindings()` fills
// them in, so the next binding is one edit here rather than one per test.
//
// Not imported by `src/index.ts`, so none of this reaches the deployed
// Worker: `wrangler deploy` bundles from that entry point outwards.

import type {Bindings} from '../types/env';
import type {BulkMailMessage} from '../lib/bulk-mail-queue';

/** A limiter that lets everything through, i.e. one that isn't the subject. */
export function allowingRateLimiter(): RateLimit {
  return {limit: () => Promise.resolve({success: true})};
}

/** A limiter that refuses everything, for the tests that are about 429s. */
export function refusingRateLimiter(): RateLimit {
  return {limit: () => Promise.resolve({success: false})};
}

const EMPTY_QUEUE_METRICS: QueueMetrics = {backlogCount: 0, backlogBytes: 0};

/**
 * A queue that keeps what was enqueued instead of sending it anywhere.
 *
 * The producer half of the bulk mail path is a `sendBatch()` call, so this
 * records the calls as well as the messages: how the recipients were split
 * across calls is part of what the route has to get right (Cloudflare caps
 * a batch at 100 messages).
 */
export class RecordingQueue<Body> implements Queue<Body> {
  /** Every message enqueued, in order, across all calls. */
  readonly sent: Body[] = [];
  /** How many messages each `send()`/`sendBatch()` call carried. */
  readonly callSizes: number[] = [];
  /**
   * The 0-based call to reject, for the tests about a queue that is
   * refusing. Left unset, every call succeeds.
   */
  failingCallIndex?: number;

  private record(bodies: Body[]): void {
    const callIndex = this.callSizes.length;
    this.callSizes.push(bodies.length);
    if (callIndex === this.failingCallIndex) {
      throw new Error('queue is unavailable');
    }
    this.sent.push(...bodies);
  }

  // The backlog figures the real binding answers with say nothing about a
  // queue nothing consumes, so they are reported as empty throughout.
  metrics(): Promise<QueueMetrics> {
    return Promise.resolve(EMPTY_QUEUE_METRICS);
  }

  send(message: Body): Promise<QueueSendResponse> {
    this.record([message]);
    return Promise.resolve({metadata: {metrics: EMPTY_QUEUE_METRICS}});
  }

  sendBatch(
    messages: Iterable<MessageSendRequest<Body>>,
  ): Promise<QueueSendBatchResponse> {
    this.record([...messages].map(message => message.body));
    return Promise.resolve({metadata: {metrics: EMPTY_QUEUE_METRICS}});
  }
}

/**
 * The platform bindings, filled so that they never interfere: nothing is
 * rate limited, the Turnstile secret is a placeholder (no test lets a real
 * siteverify call leave the process -- see `turnstileAwareFetch`), and the
 * queue swallows whatever it is given. A test that is *about* one of them
 * overrides that field with its own after spreading this in.
 */
export const PERMISSIVE_PLATFORM_BINDINGS: Pick<
  Bindings,
  | 'TURNSTILE_SECRET_KEY'
  | 'LOGIN_IP_RATE_LIMITER'
  | 'LOGIN_EMAIL_RATE_LIMITER'
  | 'MAIL_TRIGGER_IP_RATE_LIMITER'
  | 'MAIL_TRIGGER_EMAIL_RATE_LIMITER'
  | 'BULK_MAIL_QUEUE'
> = {
  TURNSTILE_SECRET_KEY: 'dummy-turnstile-secret',
  LOGIN_IP_RATE_LIMITER: allowingRateLimiter(),
  LOGIN_EMAIL_RATE_LIMITER: allowingRateLimiter(),
  MAIL_TRIGGER_IP_RATE_LIMITER: allowingRateLimiter(),
  MAIL_TRIGGER_EMAIL_RATE_LIMITER: allowingRateLimiter(),
  BULK_MAIL_QUEUE: new RecordingQueue<BulkMailMessage>(),
};

/**
 * A full `Bindings` for a test: placeholders for every secret and variable,
 * the permissive platform bindings above, and then `overrides`.
 *
 * The placeholders point nowhere real -- `SUPABASE_URL` in particular is an
 * address no test reaches without stubbing `fetch`. The integration suites
 * override it (and the key) with the local stack's, from `test-support/db`.
 * @param overrides Fields to replace, e.g. the `SESSION_SECRET` a test signs
 *     its tokens with.
 */
export function testBindings(overrides: Partial<Bindings> = {}): Bindings {
  return {
    ...PERMISSIVE_PLATFORM_BINDINGS,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'dummy-service-role-key',
    MAIL_API_KEY: 'dummy-mail-api-key',
    GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
    MAIL_FROM_ADDRESS: 'entry@example.com',
    FRONTEND_URL: 'https://entry.example.com',
    SESSION_SECRET: 'test-session-secret',
    ...overrides,
  };
}

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
