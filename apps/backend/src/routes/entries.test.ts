import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {sign} from 'hono/jwt';
import type {Bindings} from '../types/env';
import {app} from '../index';
import {ENTRY_NOTICE_SUBJECT} from '../lib/entry-notice';
import {hashPassword} from '../lib/password';
import {
  PERMISSIVE_PLATFORM_BINDINGS,
  refusingRateLimiter,
  TURNSTILE_TEST_TOKEN,
  turnstileAwareFetch,
} from '../test-support/bindings';
import {TURNSTILE_TOKEN_HEADER} from '../middleware/turnstile';

// These requests are rejected by `zValidator()` or by the challenge in front
// of it before any database call, so they run unconditionally (including
// CI).
const env: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'dummy-service-role-key',
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
  regulationIds: ['11111111-1111-1111-1111-111111111111'],
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
      env: {...env, MAIL_TRIGGER_IP_RATE_LIMITER: refusingRateLimiter()},
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

// --- Mocked Supabase ---------------------------------------------------
//
// The tests below go past the challenge into `createEntry*()`, so they
// answer the PostgREST and Resend calls it makes. Enough of each table is
// faked to tell the paths apart: which tables were written to, and which
// mails went out to whom.

const TOURNAMENT_ID = '22222222-2222-2222-2222-222222222222';
const REGION_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_REGION_ID = '44444444-4444-4444-4444-444444444444';
const PARTICIPANT_ID = '55555555-5555-5555-5555-555555555555';
const NEW_PARTICIPANT_ID = '66666666-6666-6666-6666-666666666666';
const ENTRY_ID = '77777777-7777-7777-7777-777777777777';
const PASSWORD_CHANGED_AT = '2026-10-01T00:00:00.000Z';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A tournament taking entries, as `checkEntrySubmission()` selects it. */
function tournamentRow(
  overrides: {entryClosesAt?: string} = {},
): Record<string, unknown> {
  return {
    id: TOURNAMENT_ID,
    name: 'テスト大会',
    region_id: REGION_ID,
    entry_opens_at: new Date(Date.now() - DAY_MS).toISOString(),
    entry_closes_at:
      overrides.entryClosesAt ?? new Date(Date.now() + DAY_MS).toISOString(),
    // Lets the dual-entry check be skipped; that rule is the integration
    // tests' business.
    regions: {allows_dual_entry: true},
    regulations: [
      {
        id: validBody.regulationIds[0],
        priority_starts_at: null,
        priority_ends_at: null,
      },
    ],
  };
}

interface SupabaseCall {
  table: string;
  method: string;
}

interface SentMail {
  to: string;
  subject: string;
  html: string;
}

interface MockSupabase {
  calls: SupabaseCall[];
  mails: SentMail[];
}

/**
 * Stands in for Supabase and Resend.
 * @param options.tournament The tournament row, or omit for the default.
 * @param options.participant The row registered under the submitted
 *     address (looked up by email and by id alike), or `null` for none.
 */
function mockSupabase(options: {
  tournament?: Record<string, unknown>;
  participant: Record<string, unknown> | null;
}): MockSupabase {
  const recorded: MockSupabase = {calls: [], mails: []};
  const tournament = options.tournament ?? tournamentRow();
  globalThis.fetch = turnstileAwareFetch((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.hostname === 'api.resend.com') {
      recorded.mails.push(JSON.parse(String(init?.body)) as SentMail);
      return Response.json({id: 'mail'});
    }
    const table = url.pathname.replace('/rest/v1/', '');
    const method = init?.method ?? 'GET';
    recorded.calls.push({table, method});
    // `.single()` / `.maybeSingle()` ask for one object rather than an
    // array, and supabase-js unwraps whichever it gets back.
    const wantsObject = (
      new Headers(init?.headers).get('accept') ?? ''
    ).includes('vnd.pgrst.object');
    const rows = (body: unknown[]): Response =>
      wantsObject
        ? body.length > 0
          ? Response.json(body[0])
          : new Response(null, {status: 406})
        : Response.json(body);

    switch (`${method} ${table}`) {
      case 'GET tournaments':
        return rows([tournament]);
      case 'GET form_field_defs':
        return rows([]);
      case 'GET participants':
        return rows(options.participant ? [options.participant] : []);
      case 'POST participants':
        return rows([{id: NEW_PARTICIPANT_ID}]);
      case 'GET entries':
        return rows([]);
      case 'POST entries':
        return rows([{id: ENTRY_ID}]);
      case 'DELETE entry_regulations':
      case 'POST entry_regulations':
      case 'POST email_verification_tokens':
        return new Response(null, {status: 201});
    }
    throw new Error(`unexpected Supabase call: ${method} ${url.pathname}`);
  }) as unknown as typeof fetch);
  return recorded;
}

/** A participant registered under `validBody.email`. */
async function registeredParticipant(
  overrides: {password?: string; regionId?: string} = {},
): Promise<Record<string, unknown>> {
  return {
    id: PARTICIPANT_ID,
    email: validBody.email,
    region_id: overrides.regionId ?? REGION_ID,
    password_hash: await hashPassword(overrides.password ?? 'password123'),
    password_changed_at: PASSWORD_CHANGED_AT,
  };
}

// What the route deferred with `waitUntil()`. Cloudflare runs these after
// the response; here they are collected so a test can await them, the same
// way `routes/password-reset.test.ts` does.
let backgroundWork: Array<Promise<unknown>> = [];

const EXECUTION_CTX = {
  waitUntil(promise: Promise<unknown>): void {
    backgroundWork.push(promise);
  },
  passThroughOnException(): void {},
} as unknown as ExecutionContext;

async function settleBackgroundWork(): Promise<void> {
  const pending = backgroundWork;
  backgroundWork = [];
  await Promise.all(pending);
}

/** Posts to an entry endpoint with a Turnstile token and an execution context. */
async function postWithContext(
  path: string,
  body: unknown,
  cookie?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    [TURNSTILE_TOKEN_HEADER]: TURNSTILE_TEST_TOKEN,
  };
  if (cookie) {
    headers.cookie = cookie;
  }
  return app.request(
    path,
    {method: 'POST', headers, body: JSON.stringify(body)},
    env,
    EXECUTION_CTX,
  );
}

/** Reads a response into the parts a client could compare. */
async function observable(
  res: Response,
): Promise<{status: number; body: string}> {
  return {status: res.status, body: await res.text()};
}

describe('POST /tournaments/:tournamentId/entries (mocked Supabase)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    await settleBackgroundWork();
    globalThis.fetch = originalFetch;
  });

  it('answers identically for a known and an unknown email', async () => {
    mockSupabase({participant: await registeredParticipant()});
    const known = await observable(
      await postWithContext(TOURNAMENT_PATH, validBody),
    );
    await settleBackgroundWork();

    mockSupabase({participant: null});
    const unknown = await observable(
      await postWithContext(TOURNAMENT_PATH, validBody),
    );

    expect(known).toEqual({status: 202, body: JSON.stringify({ok: true})});
    expect(unknown).toEqual(known);
  });

  it('answers identically for a registered email with a wrong password', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant({password: 'the-real-one'}),
    });

    const res = await observable(
      await postWithContext(TOURNAMENT_PATH, validBody),
    );
    await settleBackgroundWork();

    expect(res).toEqual({status: 202, body: JSON.stringify({ok: true})});
    // The reason goes to the owner of the address, and no entry is made.
    expect(recorded.mails).toHaveLength(1);
    expect(recorded.mails[0]).toMatchObject({
      to: validBody.email,
      subject: ENTRY_NOTICE_SUBJECT,
    });
    expect(recorded.mails[0].html).toContain('パスワード');
    expect(recorded.calls).not.toContainEqual({
      table: 'entries',
      method: 'POST',
    });
  });

  it('mails the owner instead of answering when the address is in another region', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant({regionId: OTHER_REGION_ID}),
    });

    const res = await observable(
      await postWithContext(TOURNAMENT_PATH, validBody),
    );
    await settleBackgroundWork();

    expect(res).toEqual({status: 202, body: JSON.stringify({ok: true})});
    expect(recorded.mails).toHaveLength(1);
    expect(recorded.mails[0].subject).toBe(ENTRY_NOTICE_SUBJECT);
    expect(recorded.mails[0].html).toContain('別の地域');
    expect(recorded.calls).not.toContainEqual({
      table: 'entries',
      method: 'POST',
    });
  });

  it('creates the account and the entry for an unknown email, after answering', async () => {
    const recorded = mockSupabase({participant: null});

    await postWithContext(TOURNAMENT_PATH, validBody);
    await settleBackgroundWork();

    expect(recorded.calls).toContainEqual({
      table: 'participants',
      method: 'POST',
    });
    expect(recorded.calls).toContainEqual({table: 'entries', method: 'POST'});
    expect(recorded.mails).toHaveLength(1);
    expect(recorded.mails[0]).toMatchObject({
      to: validBody.email,
      subject: 'エントリー確認メール',
    });
  });

  // These refusals don't depend on the address, so reporting them leaks
  // nothing, and the form can still point at what went wrong.
  it('still answers an address-independent refusal directly', async () => {
    const recorded = mockSupabase({
      tournament: tournamentRow({
        entryClosesAt: new Date(Date.now() - DAY_MS / 2).toISOString(),
      }),
      participant: null,
    });

    const res = await postWithContext(TOURNAMENT_PATH, validBody);
    await settleBackgroundWork();

    expect(res.status).toBe(403);
    expect((await res.json()) as unknown).toEqual({
      error: 'entry period closed',
    });
    expect(recorded.calls).not.toContainEqual({
      table: 'participants',
      method: 'GET',
    });
    expect(recorded.mails).toHaveLength(0);
  });
});

describe('POST /tournaments/:tournamentId/entries/session (mocked Supabase)', () => {
  const originalFetch = globalThis.fetch;
  const SESSION_PATH = `${TOURNAMENT_PATH}/session`;
  // The entry without its credentials: the session says whose it is.
  const sessionBody = {
    name: validBody.name,
    furigana: validBody.furigana,
    displayName: validBody.displayName,
    regulationIds: validBody.regulationIds,
    customFieldValues: validBody.customFieldValues,
  };

  async function sessionCookie(): Promise<string> {
    const token = await sign(
      {
        sub: PARTICIPANT_ID,
        pwdChangedAt: Date.parse(PASSWORD_CHANGED_AT),
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      env.SESSION_SECRET,
    );
    return `participant_session=${token}`;
  }

  afterEach(async () => {
    await settleBackgroundWork();
    globalThis.fetch = originalFetch;
  });

  it('refuses a request without a session', async () => {
    mockSupabase({participant: null});

    const res = await postWithContext(SESSION_PATH, sessionBody);

    expect(res.status).toBe(401);
  });

  it('enters the logged-in participant and mails their own address', async () => {
    const recorded = mockSupabase({participant: await registeredParticipant()});

    const res = await postWithContext(
      SESSION_PATH,
      sessionBody,
      await sessionCookie(),
    );

    expect(res.status).toBe(201);
    expect((await res.json()) as unknown).toEqual({id: ENTRY_ID});
    expect(recorded.calls).not.toContainEqual({
      table: 'participants',
      method: 'POST',
    });
    expect(recorded.mails).toHaveLength(1);
    expect(recorded.mails[0]).toMatchObject({
      to: validBody.email,
      subject: 'エントリー確認メール',
    });
  });

  // The session has already proved who is asking, so telling them leaks
  // nothing they don't know.
  it('still reports errors directly for a logged-in participant', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant({regionId: OTHER_REGION_ID}),
    });

    const res = await postWithContext(
      SESSION_PATH,
      sessionBody,
      await sessionCookie(),
    );

    expect(res.status).toBe(409);
    expect((await res.json()) as unknown).toEqual({
      error: 'already registered in another region',
    });
    expect(recorded.mails).toHaveLength(0);
  });
});
