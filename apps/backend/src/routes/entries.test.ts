import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import type {Bindings} from '../types/env';
import app from '../index';
import {
  PERMISSIVE_SECURITY_BINDINGS,
  refusingRateLimiter,
  TURNSTILE_TEST_TOKEN,
  turnstileAwareFetch,
} from '../test-support/bindings';
import {TURNSTILE_TOKEN_HEADER} from '../middleware/turnstile';

// These requests are rejected by `zValidator()` or by the challenge in front
// of it before any database call, so they run unconditionally (including
// CI).
const env: Bindings = {
  ...PERMISSIVE_SECURITY_BINDINGS,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

const TOURNAMENT_PATH =
  '/api/tournaments/22222222-2222-2222-2222-222222222222/entries';

const validBody = {
  name: '山田太郎',
  furigana: 'ヤマダタロウ',
  displayName: '太郎',
  email: 'entrant@example.com',
  password: 'password123',
  passwordConfirm: 'password123',
  regulationId: '11111111-1111-1111-1111-111111111111',
  customFieldValues: {},
};

/**
 * Posts an entry the way the frontend does, with a Turnstile token.
 * @param path The endpoint to post to.
 * @param body The entry being submitted.
 * @param options.env Overrides the bindings, for the rate limiter test.
 * @param options.turnstileToken The token to send, or `null` to send none.
 */
async function postEntry(
  path: string,
  body: unknown,
  options: {env?: Bindings; turnstileToken?: string | null} = {},
): Promise<Response> {
  const {env: bindings = env, turnstileToken = TURNSTILE_TEST_TOKEN} = options;
  const headers: Record<string, string> = {'content-type': 'application/json'};
  if (turnstileToken !== null) {
    headers[TURNSTILE_TOKEN_HEADER] = turnstileToken;
  }
  return app.request(
    path,
    {method: 'POST', headers, body: JSON.stringify(body)},
    bindings,
  );
}

/** Answers siteverify only; anything else means the request got too far. */
function mockFetch(turnstileVerified = true): void {
  globalThis.fetch = turnstileAwareFetch(
    (() => {
      throw new Error('unexpected fetch');
    }) as unknown as typeof fetch,
    turnstileVerified,
  );
}

describe('POST /tournaments/:tournamentId/entries (request validation)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects a non-UUID tournamentId with 400', async () => {
    const res = await postEntry(
      '/api/tournaments/not-a-uuid/entries',
      validBody,
    );

    expect(res.status).toBe(400);
  });

  it('rejects a body missing required fields with 400', async () => {
    const res = await postEntry(TOURNAMENT_PATH, {
      ...validBody,
      email: undefined,
    });

    expect(res.status).toBe(400);
  });

  it('rejects mismatched password confirmation with 400', async () => {
    const res = await postEntry(TOURNAMENT_PATH, {
      ...validBody,
      passwordConfirm: 'different',
    });

    expect(res.status).toBe(400);
  });

  it('returns 429 with Retry-After when the rate limiter refuses', async () => {
    const res = await postEntry(TOURNAMENT_PATH, validBody, {
      env: {...env, MAIL_TRIGGER_RATE_LIMITER: refusingRateLimiter()},
    });

    const body: unknown = await res.json();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(body).toEqual({error: 'too many requests'});
  });

  it('returns 400 when the Turnstile token is missing', async () => {
    const res = await postEntry(TOURNAMENT_PATH, validBody, {
      turnstileToken: null,
    });

    const body: unknown = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({error: 'turnstile verification failed'});
  });

  it('returns 400 when Turnstile refuses the token', async () => {
    mockFetch(false);

    const res = await postEntry(TOURNAMENT_PATH, validBody);

    expect(res.status).toBe(400);
  });
});
