import {afterEach, describe, expect, it} from 'bun:test';
import {passwordResetRoute} from './password-reset';
import {Hono} from 'hono';
import {dbClient} from '../middleware/db';
import type {Env} from '../types/env';
import type {Bindings} from '../types/env';
import {
  testBindings,
  refusingRateLimiter,
  TURNSTILE_TEST_TOKEN,
  turnstileAwareFetch,
} from '../test-support/bindings';
import {TURNSTILE_TOKEN_HEADER} from '../middleware/turnstile';

// The route behind the middleware that gives it its database client, as
// `index.ts` mounts it.
const routeUnderTest = new Hono<Env>()
  .use(dbClient())
  .route('/', passwordResetRoute);

const ENV = testBindings();

const PARTICIPANT_ID = '44444444-4444-4444-4444-444444444444';

interface MockedTables {
  participants?: Record<string, unknown>[];
  passwordResetTokens?: Record<string, unknown>[];
}

// Every URL `fetch` was called with since the last `mockFetch()`, so a test
// can tell what the route did on the response path from what it deferred.
let requestedUrls: string[] = [];

// Held shut by a test that wants to see the response arrive while the
// deferred work is still waiting on its first call. Timing alone can't tell
// "deferred" from "started just before the response" (#310).
let gate: Promise<void> = Promise.resolve();

/**
 * Answers the PostgREST and Resend calls the route makes with canned rows.
 * @param tables The rows each table's request resolves to.
 */
function mockFetch(tables: MockedTables): void {
  requestedUrls = [];
  gate = Promise.resolve();
  // Wrapped so that Turnstile's siteverify is answered by the wrapper rather
  // than by the stub below -- which would otherwise hand `verifyTurnstile` a
  // list of participant rows, read no `success` in it, and turn every test
  // here into a test of a refused token. It also keeps the call out of
  // `requestedUrls`, which the tests below read as "what the route did on
  // the response path": the challenge is checked before the route is
  // reached at all.
  globalThis.fetch = turnstileAwareFetch((async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    requestedUrls.push(url);
    await gate;
    if (url.startsWith('https://api.resend.com/')) {
      return new Response(null, {status: 200});
    }
    if (url.includes('/password_reset_tokens')) {
      return Response.json(tables.passwordResetTokens ?? []);
    }
    return Response.json(tables.participants ?? []);
  }) as unknown as typeof fetch);
}

// What `/request` deferred with `waitUntil()`. Cloudflare runs these after
// the response; here they are collected so a test can await them explicitly
// instead of leaking into the next one.
let backgroundWork: Array<Promise<unknown>> = [];

const EXECUTION_CTX = {
  waitUntil(promise: Promise<unknown>): void {
    backgroundWork.push(promise);
  },
  passThroughOnException(): void {},
} as unknown as ExecutionContext;

/** Runs the work `/request` deferred, the way the Workers runtime would. */
async function settleBackgroundWork(): Promise<void> {
  const pending = backgroundWork;
  backgroundWork = [];
  await Promise.all(pending);
}

async function post(
  path: string,
  body: unknown,
  options: {env?: Bindings; turnstileToken?: string | null} = {},
): Promise<Response> {
  const {env = ENV, turnstileToken = TURNSTILE_TEST_TOKEN} = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // `/confirm` is not behind the challenge and ignores the header; sending
  // it there anyway keeps this helper to one shape.
  if (turnstileToken !== null) {
    headers[TURNSTILE_TOKEN_HEADER] = turnstileToken;
  }
  return routeUnderTest.request(
    path,
    {method: 'POST', headers, body: JSON.stringify(body)},
    env,
    EXECUTION_CTX,
  );
}

describe('POST /request', () => {
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    await settleBackgroundWork();
    globalThis.fetch = originalFetch;
  });

  it('returns the same 200 for a registered and an unregistered email', async () => {
    mockFetch({participants: [{id: PARTICIPANT_ID}]});
    const registered = await post('/request', {email: 'known@example.com'});
    await settleBackgroundWork();

    mockFetch({participants: []});
    const unregistered = await post('/request', {email: 'unknown@example.com'});
    await settleBackgroundWork();

    const registeredBody: unknown = await registered.json();
    const unregisteredBody: unknown = await unregistered.json();
    expect(registered.status).toBe(200);
    expect(unregistered.status).toBe(200);
    expect(registeredBody).toEqual(unregisteredBody);
  });

  it('answers a registered email without doing any of the reset work first', async () => {
    mockFetch({participants: [{id: PARTICIPANT_ID}]});
    let release!: () => void;
    gate = new Promise<void>(resolve => {
      release = resolve;
    });

    // The point of deferring: had the lookup, the token insert or the Resend
    // call been waited on before the response, a registered address would
    // take measurably longer than an unregistered one and the identical body
    // would not hide which is which. With the first call held shut, the
    // response only arrives if nothing waits on the work.
    const res = await post('/request', {email: 'known@example.com'});
    expect(res.status).toBe(200);
    expect(
      requestedUrls.some(url => url.startsWith('https://api.resend.com/')),
    ).toBe(false);

    release();
    await settleBackgroundWork();
    expect(
      requestedUrls.some(url => url.startsWith('https://api.resend.com/')),
    ).toBe(true);
  });

  it('returns 429 with Retry-After when the rate limiter refuses', async () => {
    mockFetch({participants: [{id: PARTICIPANT_ID}]});

    const res = await post(
      '/request',
      {email: 'known@example.com'},
      {env: {...ENV, MAIL_TRIGGER_IP_RATE_LIMITER: refusingRateLimiter()}},
    );

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    // Refused before the mail was even queued, which is the whole point:
    // this endpoint mails whatever address it is given.
    expect(requestedUrls).toEqual([]);
  });

  it('counts the per-address limit under a key naming this endpoint', async () => {
    // Named, so that requests here cannot spend the entry form's budget for
    // the same address and keep its owner from entering (#295).
    mockFetch({participants: []});
    const keys: string[] = [];
    const recording: RateLimit = {
      limit: ({key}) => {
        keys.push(key ?? '');
        return Promise.resolve({success: true});
      },
    };

    await post(
      '/request',
      {email: 'Shared@Example.com'},
      {env: {...ENV, MAIL_TRIGGER_EMAIL_RATE_LIMITER: recording}},
    );

    expect(keys).toEqual([
      'participant-password-reset:email:shared@example.com',
    ]);
  });

  it('returns 400 when the Turnstile token is missing', async () => {
    mockFetch({participants: [{id: PARTICIPANT_ID}]});

    const res = await post(
      '/request',
      {email: 'known@example.com'},
      {turnstileToken: null},
    );

    const body: unknown = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({error: 'turnstile verification failed'});
    expect(requestedUrls).toEqual([]);
  });

  it('returns 400 when Turnstile refuses the token', async () => {
    mockFetch({participants: [{id: PARTICIPANT_ID}]});
    // Same stub, but siteverify now says the token is no good.
    globalThis.fetch = turnstileAwareFetch(globalThis.fetch, false);

    const res = await post('/request', {email: 'known@example.com'});

    expect(res.status).toBe(400);
    expect(requestedUrls).toEqual([]);
  });

  it('returns 400 for a malformed email', async () => {
    mockFetch({});

    const res = await post('/request', {email: 'not-an-email'});

    expect(res.status).toBe(400);
    expect(requestedUrls).toEqual([]);
  });
});

describe('POST /confirm', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns 200 when the token is consumed', async () => {
    mockFetch({passwordResetTokens: [{participant_id: PARTICIPANT_ID}]});

    const res = await post('/confirm', {
      token: 'a'.repeat(64),
      newPassword: 'brand-new-password',
    });

    // `Response#json()` types as `Promise<any>`; annotate as `unknown` so
    // `expect()` resolves its generic overload instead of the `never` one.
    const body: unknown = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ok: true});
  });

  it('returns 400 when no unused, unexpired token matches', async () => {
    mockFetch({passwordResetTokens: []});

    const res = await post('/confirm', {
      token: 'a'.repeat(64),
      newPassword: 'brand-new-password',
    });

    const body: unknown = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({error: 'invalid or expired token'});
  });

  it('returns 400 for a new password shorter than 8 characters', async () => {
    mockFetch({passwordResetTokens: [{participant_id: PARTICIPANT_ID}]});

    const res = await post('/confirm', {
      token: 'a'.repeat(64),
      newPassword: 'short',
    });

    expect(res.status).toBe(400);
  });

  it('hides the database message behind a fixed 500 body', async () => {
    const originalConsoleError = console.error;
    console.error = () => {};
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json(
          {message: 'relation "password_reset_tokens" does not exist'},
          {status: 500},
        ),
      )) as unknown as typeof fetch;

    try {
      const res = await post('/confirm', {
        token: 'a'.repeat(64),
        newPassword: 'brand-new-password',
      });

      const body: unknown = await res.json();
      expect(res.status).toBe(500);
      expect(body).toEqual({error: 'internal server error'});
    } finally {
      console.error = originalConsoleError;
    }
  });
});
