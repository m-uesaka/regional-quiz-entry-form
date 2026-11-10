import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {sign} from 'hono/jwt';
import type {Bindings} from '../types/env';
import {app} from '../index';
import {entryNoticeSubject} from '../lib/entry-notice';
import {verificationMailSubject} from '../lib/entry-verification';
import {hashPassword, verifyPassword} from '../lib/password';
import {legacyHashPassword} from '../test-support/password';
import {
  RecordingQueue,
  testBindings,
  refusingRateLimiter,
  TURNSTILE_TEST_TOKEN,
  turnstileAwareFetch,
} from '../test-support/bindings';
import {TURNSTILE_TOKEN_HEADER} from '../middleware/turnstile';
import {emailKey} from '../middleware/rate-limit';
import type {BulkMailMessage} from '../lib/bulk-mail-queue';
import {ENTRY_MAIL_DEFER_SECONDS} from '../lib/deferred-entry-mail';
import {
  FOREIGN_KEY_VIOLATION_SQLSTATE,
  NO_ROW_PGRST_CODE,
  PARTICIPANT_REGION_SQLSTATE,
  REGION_DUAL_ENTRY_SQLSTATE,
} from '../lib/pg-errors';

// These requests are rejected by `zValidator()` or by the challenge in front
// of it before any database call, so they run unconditionally (including
// CI).
const env = testBindings();

const TOURNAMENT_PATH =
  '/api/tournaments/22222222-2222-2222-2222-222222222222/entries';

const validBody = {
  name: '山田太郎',
  furigana: 'ヤマダタロウ',
  displayName: '太郎',
  email: 'entrant@example.com',
  password: 'quiz-entry-pass1',
  passwordConfirm: 'quiz-entry-pass1',
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

  // `JSON.stringify` writes it as the `\ud800` escape, as an attacker would.
  // The database refused it with a 500 before the schema did (#298).
  it('rejects a lone surrogate in the free text or an answer with 400', async () => {
    for (const body of [
      {...validBody, freeText: '\ud800'},
      {...validBody, customFieldValues: {comment: '\udc00'}},
    ]) {
      const res = await postEntry(TOURNAMENT_PATH, body);

      expect(res.status).toBe(400);
    }
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

  // #346: an address's budget is spent only by submissions that could be
  // entered, so a flood aimed at a closed or unknown tournament costs its
  // owner nothing.
  it('spends no per-address budget on a tournament that does not exist', async () => {
    const keys: string[] = [];
    const recording: RateLimit = {
      limit: ({key}) => {
        keys.push(key ?? '');
        return Promise.resolve({success: true});
      },
    };
    // The tournament lookup finds nothing, so the route answers 400.
    globalThis.fetch = turnstileAwareFetch((() =>
      Promise.resolve(Response.json([]))) as unknown as typeof fetch);

    const res = await postEntry(TOURNAMENT_PATH, validBody, {
      env: {...env, MAIL_TRIGGER_EMAIL_RATE_LIMITER: recording},
    });

    expect(res.status).toBe(400);
    expect(keys).toEqual([]);
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
const TOURNAMENT_NAME = 'テスト大会';
const PARTICIPANT_ID = '55555555-5555-5555-5555-555555555555';
const NEW_PARTICIPANT_ID = '66666666-6666-6666-6666-666666666666';
const ENTRY_ID = '77777777-7777-7777-7777-777777777777';
const PASSWORD_CHANGED_AT = '2026-10-01T00:00:00.000Z';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The cancelled entry a re-entry reuses, as `findReusableEntry()` reads it. */
const CANCELLED_ENTRY = {
  id: ENTRY_ID,
  name: '以前の氏名',
  furigana: 'イゼンノシメイ',
  display_name: '以前',
  entry_regulations: [],
  free_text: null,
  custom_field_values: {},
  status: 'cancelled',
  waitlist_position: null,
  email_verified_at: null,
  cancelled_at: new Date(Date.now() - DAY_MS).toISOString(),
};

/** A tournament taking entries, as `checkEntrySubmission()` selects it. */
function tournamentRow(
  overrides: {
    entryClosesAt?: string;
    capacity?: number | null;
    entriesPaused?: boolean;
    regulations?: Array<Record<string, unknown>>;
  } = {},
): Record<string, unknown> {
  return {
    id: TOURNAMENT_ID,
    name: TOURNAMENT_NAME,
    capacity: overrides.capacity ?? null,
    entry_opens_at: new Date(Date.now() - DAY_MS).toISOString(),
    entry_closes_at:
      overrides.entryClosesAt ?? new Date(Date.now() + DAY_MS).toISOString(),
    entries_paused: overrides.entriesPaused ?? false,
    regions: {name: '東京'},
    regulations: overrides.regulations ?? [
      {
        id: validBody.regulationIds[0],
        priority_starts_at: null,
        priority_ends_at: null,
        closes_with_priority: false,
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
  /** The arguments each `take_over_unverified_participant()` call got. */
  takeOvers: Array<Record<string, unknown>>;
  /** The arguments each `reenter_cancelled_entry()` call got. */
  reentries: Array<Record<string, unknown>>;
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
  /** Makes storing the verification token fail, so no link can be sent. */
  failVerificationToken?: boolean;
  /**
   * What `take_over_unverified_participant()` answers: false when the
   * address was verified in the meantime.
   */
  takeOver?: boolean;
  /**
   * The tournaments whose pending entries the takeover reports withdrawn
   * (none by default).
   */
  withdrawn?: string[];
  /**
   * What the participant row reads as once the takeover is refused: the
   * account another submission took over and had confirmed in between.
   */
  verifiedMeanwhile?: Record<string, unknown>;
  /**
   * The SQLSTATE the entry write is refused with, if it is. Nothing is asked
   * of the database ahead of the write (#308) -- the mock throws on a call
   * it doesn't know, `claim_participant_region_for_tournament()` and
   * `participant_holds_conflicting_region()` included -- so
   * `PARTICIPANT_REGION_SQLSTATE` here is how a participant holding a seat
   * in another region on the same question set looks.
   */
  entryWriteErrorCode?: string;
  /** The SQLSTATE storing the entry's regulations is refused with, if it is. */
  regulationsWriteErrorCode?: string;
  /** The participant's cancelled entry for the tournament, if any. */
  cancelledEntry?: Record<string, unknown>;
  /** Makes `reenter_cancelled_entry()` match no row: the row was taken. */
  reentryMatchesNoRow?: boolean;
}): MockSupabase {
  const recorded: MockSupabase = {
    calls: [],
    mails: [],
    takeOvers: [],
    reentries: [],
  };
  const tournament = options.tournament ?? tournamentRow();
  // Written to by the account creation and the takeover, so the re-read
  // after the entry is written (`isStillUnverifiedAccountOf()`) sees the
  // hash this submission set, as it would against Postgres.
  let participant = options.participant ? {...options.participant} : null;
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

    const entryWritten = (): Response =>
      options.entryWriteErrorCode
        ? Response.json(
            {code: options.entryWriteErrorCode, message: 'refused'},
            // What PostgREST answers: 500 for a code the triggers raise, and
            // 409 for Postgres' own constraint violations.
            {status: options.entryWriteErrorCode.startsWith('P0') ? 500 : 409},
          )
        : rows([{id: ENTRY_ID}]);

    switch (`${method} ${table}`) {
      case 'GET tournaments':
        return rows([tournament]);
      case 'GET form_field_defs':
        return rows([]);
      case 'GET participants':
        return rows(participant ? [participant] : []);
      case 'POST participants':
        participant = {
          ...(JSON.parse(String(init?.body)) as Record<string, unknown>),
          id: NEW_PARTICIPANT_ID,
        };
        return rows([{id: NEW_PARTICIPANT_ID}]);
      case 'POST rpc/take_over_unverified_participant': {
        const args = JSON.parse(String(init?.body)) as Record<string, unknown>;
        recorded.takeOvers.push(args);
        const tookOver = options.takeOver ?? true;
        if (tookOver && participant) {
          participant = {
            ...participant,
            password_hash: args.p_password_hash,
          };
        }
        if (!tookOver && options.verifiedMeanwhile) {
          participant = {...options.verifiedMeanwhile};
        }
        return Response.json(tookOver ? (options.withdrawn ?? []) : null);
      }
      // The rehash of a registered participant's legacy hash.
      case 'PATCH participants':
        return new Response(null, {status: 204});
      // Nothing of this participant's has a lapsed verification link.
      case 'POST rpc/lapse_expired_pending_entries':
        return Response.json([]);
      case 'GET entries':
        return rows(options.cancelledEntry ? [options.cancelledEntry] : []);
      case 'POST rpc/reenter_cancelled_entry':
        recorded.reentries.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        );
        if (options.reentryMatchesNoRow) {
          return Response.json(
            {code: NO_ROW_PGRST_CODE, message: 'no rows'},
            {status: 406},
          );
        }
        return entryWritten();
      case 'POST entries':
        return entryWritten();
      case 'POST email_verification_tokens':
        return options.failVerificationToken
          ? Response.json({message: 'boom'}, {status: 500})
          : Response.json({id: 'token-id'}, {status: 201});
      case 'POST entry_regulations':
        return options.regulationsWriteErrorCode
          ? Response.json(
              {code: options.regulationsWriteErrorCode, message: 'refused'},
              {status: 409},
            )
          : new Response(null, {status: 201});
      // The last two are the rollback after a failed verification mail.
      case 'DELETE entry_regulations':
      case 'DELETE email_verification_tokens':
      case 'DELETE entries':
        return new Response(null, {status: 201});
    }
    throw new Error(`unexpected Supabase call: ${method} ${url.pathname}`);
  }) as unknown as typeof fetch);
  return recorded;
}

/**
 * A participant registered under `validBody.email`, by default one whose
 * address has been verified.
 */
async function registeredParticipant(
  overrides: {password?: string; verified?: boolean} = {},
): Promise<Record<string, unknown>> {
  return {
    id: PARTICIPANT_ID,
    email: validBody.email,
    password_hash: await hashPassword(overrides.password ?? 'quiz-entry-pass1'),
    password_changed_at: PASSWORD_CHANGED_AT,
    email_verified_at:
      overrides.verified === false ? null : PASSWORD_CHANGED_AT,
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
  bindings: Bindings = env,
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
    bindings,
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

  it('counts the per-address limit under a key naming this endpoint', async () => {
    const keys: string[] = [];
    const recording: RateLimit = {
      limit: ({key}) => {
        keys.push(key ?? '');
        return Promise.resolve({success: true});
      },
    };
    mockSupabase({participant: null});

    await postWithContext(
      TOURNAMENT_PATH,
      {...validBody, email: 'Shared@Example.com'},
      undefined,
      {...env, MAIL_TRIGGER_EMAIL_RATE_LIMITER: recording},
    );

    expect(keys).toEqual(['entry:email:shared@example.com']);
  });

  it('mails at once for an address whose reset requests used up their budget', async () => {
    // The attack in #295: reset requests with the victim's address, so that
    // the victim's entry is held back when entries open. The two endpoints
    // share the limiter, so this one counts like the real binding -- a
    // budget per key.
    const budget = 3;
    const spent = new Map<string, number>();
    const counting: RateLimit = {
      limit: ({key}) => {
        const used = (spent.get(key ?? '') ?? 0) + 1;
        spent.set(key ?? '', used);
        return Promise.resolve({success: used <= budget});
      },
    };
    const queue = new RecordingQueue<BulkMailMessage>();
    const bindings = {
      ...env,
      MAIL_TRIGGER_EMAIL_RATE_LIMITER: counting,
      BULK_MAIL_QUEUE: queue,
    };
    const recorded = mockSupabase({participant: null});
    // The reset endpoint's own budget, used up.
    spent.set(
      emailKey('participant-password-reset', validBody.email),
      budget + 1,
    );

    const res = await postWithContext(
      TOURNAMENT_PATH,
      validBody,
      undefined,
      bindings,
    );
    await settleBackgroundWork();

    expect(res.status).toBe(202);
    expect(spent.get(emailKey('entry', validBody.email))).toBe(1);
    expect(recorded.mails.map(mail => mail.subject)).toEqual([
      verificationMailSubject(TOURNAMENT_NAME),
    ]);
    expect(queue.sent).toEqual([]);
  });

  // #346: over the per-address limit the submission is entered as usual,
  // and only its mail waits on the queue.
  describe('over the per-address limit', () => {
    function overLimit(): {
      bindings: Bindings;
      queue: RecordingQueue<BulkMailMessage>;
    } {
      const queue = new RecordingQueue<BulkMailMessage>();
      return {
        queue,
        bindings: {
          ...env,
          MAIL_TRIGGER_EMAIL_RATE_LIMITER: refusingRateLimiter(),
          BULK_MAIL_QUEUE: queue,
        },
      };
    }

    it('answers 202, writes the entry and defers its verification mail', async () => {
      const recorded = mockSupabase({participant: null});
      const {bindings, queue} = overLimit();

      const res = await observable(
        await postWithContext(TOURNAMENT_PATH, validBody, undefined, bindings),
      );
      await settleBackgroundWork();

      // The same answer as any other submission: no 429 to keep the owner
      // out, and nothing that says the address was being flooded.
      expect(res).toEqual({status: 202, body: JSON.stringify({ok: true})});
      expect(recorded.calls).toContainEqual({table: 'entries', method: 'POST'});
      // The expired placeholder that lets the entry lapse if the mail is lost.
      expect(recorded.calls).toContainEqual({
        table: 'email_verification_tokens',
        method: 'POST',
      });
      expect(recorded.mails).toEqual([]);
      expect(queue.sent).toEqual([
        {
          kind: 'deferred-verification',
          entryId: ENTRY_ID,
          to: validBody.email,
        },
      ]);
      expect(queue.sendOptions).toEqual([
        {delaySeconds: ENTRY_MAIL_DEFER_SECONDS},
      ]);
    });

    it('defers the notice of a submission that was not entered', async () => {
      const recorded = mockSupabase({
        participant: await registeredParticipant({password: 'the-real-one'}),
      });
      const {bindings, queue} = overLimit();

      await postWithContext(TOURNAMENT_PATH, validBody, undefined, bindings);
      await settleBackgroundWork();

      expect(recorded.mails).toEqual([]);
      expect(queue.sent).toEqual([
        {
          kind: 'deferred-notice',
          to: validBody.email,
          tournamentName: TOURNAMENT_NAME,
          reason: 'password-mismatch',
        },
      ]);
    });

    it('rolls the entry back when the mail cannot be deferred', async () => {
      const recorded = mockSupabase({participant: null});
      const {bindings, queue} = overLimit();
      // The first call is the verification mail; the notice after the
      // rollback goes through.
      queue.failingCallIndex = 0;
      const originalConsoleError = console.error;
      console.error = () => {};
      try {
        await postWithContext(TOURNAMENT_PATH, validBody, undefined, bindings);
        await settleBackgroundWork();
      } finally {
        console.error = originalConsoleError;
      }

      expect(recorded.calls).toContainEqual({
        table: 'entries',
        method: 'DELETE',
      });
      expect(queue.sent).toEqual([
        {
          kind: 'deferred-notice',
          to: validBody.email,
          tournamentName: TOURNAMENT_NAME,
          reason: 'processing-failed',
        },
      ]);
    });
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
      subject: entryNoticeSubject(TOURNAMENT_NAME),
    });
    expect(recorded.mails[0].html).toContain('パスワード');
    expect(recorded.calls).not.toContainEqual({
      table: 'entries',
      method: 'POST',
    });
  });

  it('mails the owner instead of answering when the address is in another region', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant(),
      entryWriteErrorCode: PARTICIPANT_REGION_SQLSTATE,
    });

    const res = await observable(
      await postWithContext(TOURNAMENT_PATH, validBody),
    );
    await settleBackgroundWork();

    expect(res).toEqual({status: 202, body: JSON.stringify({ok: true})});
    expect(recorded.mails).toHaveLength(1);
    expect(recorded.mails[0].subject).toBe(entryNoticeSubject(TOURNAMENT_NAME));
    expect(recorded.mails[0].html).toContain('別の地域');
    // The refused write left nothing behind, so there is nothing to undo.
    expect(recorded.calls).not.toContainEqual({
      table: 'entries',
      method: 'DELETE',
    });
  });

  // #236: nothing but a cancelled entry is left in the old region.
  it('enters a verified participant with nothing left in their old region', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant(),
    });

    await postWithContext(TOURNAMENT_PATH, validBody);
    await settleBackgroundWork();

    expect(recorded.calls).toContainEqual({table: 'entries', method: 'POST'});
    expect(recorded.mails[0].subject).toBe(
      verificationMailSubject(TOURNAMENT_NAME),
    );
  });

  it('never writes an entry to a verified account for a wrong password', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant({
        password: 'the-real-password',
      }),
    });

    await postWithContext(TOURNAMENT_PATH, validBody);
    await settleBackgroundWork();

    expect(recorded.calls).not.toContainEqual({
      table: 'entries',
      method: 'POST',
    });
    expect(recorded.mails[0].html).toContain('パスワード');
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
      subject: verificationMailSubject(TOURNAMENT_NAME),
    });
    // The tournament is uncapped, so there is no waitlist to mention.
    expect(recorded.mails[0].html).not.toContain('キャンセル待ち');
  });

  it('mentions the waitlist in the verification mail of a capped tournament', async () => {
    const recorded = mockSupabase({
      tournament: tournamentRow({capacity: 10}),
      participant: null,
    });

    await postWithContext(TOURNAMENT_PATH, validBody);
    await settleBackgroundWork();

    expect(recorded.mails).toHaveLength(1);
    expect(recorded.mails[0].html).toContain(
      '定員に空きがない場合は、キャンセル待ちとして受け付けます(すでにキャンセル待ちの方がいる場合は、その後ろに並びます)。',
    );
  });

  it('rehashes a legacy password when entering under a registered address', async () => {
    // Some participants only ever come back through this form, so the
    // upgrade the login does has to happen here too.
    const recorded = mockSupabase({
      participant: {
        ...(await registeredParticipant()),
        password_hash: await legacyHashPassword('quiz-entry-pass1'),
      },
    });

    await postWithContext(TOURNAMENT_PATH, validBody);
    await settleBackgroundWork();

    expect(recorded.calls).toContainEqual({
      table: 'participants',
      method: 'PATCH',
    });
    expect(recorded.calls).toContainEqual({table: 'entries', method: 'POST'});
  });

  it('does not rewrite a current hash when entering under a registered address', async () => {
    const recorded = mockSupabase({participant: await registeredParticipant()});

    await postWithContext(TOURNAMENT_PATH, validBody);
    await settleBackgroundWork();

    expect(recorded.calls).not.toContainEqual({
      table: 'participants',
      method: 'PATCH',
    });
    expect(recorded.calls).toContainEqual({table: 'entries', method: 'POST'});
  });

  // A new account is held to the rules for setting a password, which the
  // form's schema can't apply: the same field proves an existing password.
  it('mails a new address that chose a common password instead of creating it', async () => {
    const recorded = mockSupabase({participant: null});

    const res = await observable(
      await postWithContext(TOURNAMENT_PATH, {
        ...validBody,
        password: 'Password123',
        passwordConfirm: 'Password123',
      }),
    );
    await settleBackgroundWork();

    expect(res).toEqual({status: 202, body: JSON.stringify({ok: true})});
    expect(recorded.calls).not.toContainEqual({
      table: 'participants',
      method: 'POST',
    });
    expect(recorded.mails).toHaveLength(1);
    expect(recorded.mails[0]).toMatchObject({
      to: validBody.email,
      subject: entryNoticeSubject(TOURNAMENT_NAME),
    });
    expect(recorded.mails[0].html).toContain('よく使われている');
  });

  it('lets a registered address re-enter with a common password it already has', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant({password: 'Password123'}),
    });

    await postWithContext(TOURNAMENT_PATH, {
      ...validBody,
      password: 'Password123',
      passwordConfirm: 'Password123',
    });
    await settleBackgroundWork();

    expect(recorded.calls).toContainEqual({table: 'entries', method: 'POST'});
  });

  // The submitter was told a mail was on its way; a failure on our side
  // after that must not leave them waiting for one that never comes.
  it('mails the owner to try again when the entry fails on our side', async () => {
    const recorded = mockSupabase({
      participant: null,
      failVerificationToken: true,
    });

    const res = await observable(
      await postWithContext(TOURNAMENT_PATH, validBody),
    );
    await settleBackgroundWork();

    expect(res).toEqual({status: 202, body: JSON.stringify({ok: true})});
    expect(recorded.calls).toContainEqual({table: 'entries', method: 'DELETE'});
    expect(recorded.mails).toHaveLength(1);
    expect(recorded.mails[0]).toMatchObject({
      to: validBody.email,
      subject: entryNoticeSubject(TOURNAMENT_NAME),
    });
    expect(recorded.mails[0].html).toContain('もう一度エントリーしてください');
  });

  // An account nobody has verified may have been made by someone who typed
  // another person's address to hold it in a far region (#189). Its password
  // and region carry no weight: the submission replaces them.
  it('takes over an unverified account, whatever its password and region', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant({
        password: 'someone-elses-password',
        verified: false,
      }),
    });

    const res = await observable(
      await postWithContext(TOURNAMENT_PATH, validBody),
    );
    await settleBackgroundWork();

    // Nothing in the answer says the address was in any particular state.
    expect(res).toEqual({status: 202, body: JSON.stringify({ok: true})});
    expect(recorded.takeOvers).toHaveLength(1);
    const [takeOver] = recorded.takeOvers;
    expect(takeOver.p_participant_id).toBe(PARTICIPANT_ID);
    // The account has no region to replace (#309).
    expect(takeOver).not.toHaveProperty('p_region_id');
    expect(
      await verifyPassword(
        validBody.password,
        String(takeOver.p_password_hash),
      ),
    ).toEqual({valid: true, needsRehash: false});
    expect(recorded.calls).toContainEqual({table: 'entries', method: 'POST'});
    expect(recorded.mails).toHaveLength(1);
    expect(recorded.mails[0]).toMatchObject({
      to: validBody.email,
      subject: verificationMailSubject(TOURNAMENT_NAME),
    });
    // Nothing was withdrawn, so nothing is reported as such.
    expect(recorded.mails[0].html).not.toContain('取り消しました');
  });

  // The withdrawn entries may have been the owner's own, made under a
  // password they mistyped this time or in another region, so the mail that
  // only reaches the owner says which ones went.
  it('tells the owner which pending entries a takeover withdrew', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant({
        password: 'someone-elses-password',
        verified: false,
      }),
      // The other tournament, plus this one, which is entered again and so
      // not reported.
      withdrawn: ['88888888-8888-8888-8888-888888888888', TOURNAMENT_ID],
    });

    await postWithContext(TOURNAMENT_PATH, validBody);
    await settleBackgroundWork();

    expect(recorded.mails).toHaveLength(1);
    expect(recorded.mails[0].subject).toBe(
      verificationMailSubject(TOURNAMENT_NAME),
    );
    // The mock answers every tournament lookup with the same row, so the
    // name is this tournament's, but it comes from the withdrawn-list read.
    expect(recorded.mails[0].html).toContain(`「${TOURNAMENT_NAME}」への`);
    expect(recorded.mails[0].html).toContain('取り消しました');
  });

  // The takeover can't be undone: a failure after it rolls back only the new
  // entry, so the notice of that failure is the one place the owner hears of
  // the entries it withdrew (#291).
  describe('failing after a takeover that withdrew pending entries', () => {
    const OTHER_TOURNAMENT_ID = '88888888-8888-8888-8888-888888888888';

    async function takenOver(
      options: Omit<Parameters<typeof mockSupabase>[0], 'participant'>,
    ): Promise<MockSupabase> {
      return mockSupabase({
        participant: await registeredParticipant({
          password: 'someone-elses-password',
          verified: false,
        }),
        ...options,
      });
    }

    async function postQuietly(bindings: Bindings = env): Promise<void> {
      const originalConsoleError = console.error;
      console.error = () => {};
      try {
        await postWithContext(TOURNAMENT_PATH, validBody, undefined, bindings);
        await settleBackgroundWork();
      } finally {
        console.error = originalConsoleError;
      }
    }

    it('names them in the notice of a regulation changed meanwhile', async () => {
      const recorded = await takenOver({
        withdrawn: [OTHER_TOURNAMENT_ID],
        regulationsWriteErrorCode: FOREIGN_KEY_VIOLATION_SQLSTATE,
      });

      await postQuietly();

      expect(recorded.calls).toContainEqual({
        table: 'entries',
        method: 'DELETE',
      });
      expect(recorded.mails).toHaveLength(1);
      expect(recorded.mails[0].subject).toBe(
        entryNoticeSubject(TOURNAMENT_NAME),
      );
      expect(recorded.mails[0].html).toContain(
        'レギュレーションが変更されました',
      );
      expect(recorded.mails[0].html).toContain(`「${TOURNAMENT_NAME}」への`);
      expect(recorded.mails[0].html).toContain('取り消しました');
    });

    // The verification mail leaves this tournament's own earlier entry out,
    // as the new one replaces it; a failed submission replaces nothing.
    it('names this tournament too in the notice of a failure on our side', async () => {
      const recorded = await takenOver({
        withdrawn: [TOURNAMENT_ID],
        failVerificationToken: true,
      });

      await postQuietly();

      expect(recorded.mails).toHaveLength(1);
      expect(recorded.mails[0].subject).toBe(
        entryNoticeSubject(TOURNAMENT_NAME),
      );
      expect(recorded.mails[0].html).toContain(
        'エラーが発生したため、エントリーを完了できませんでした',
      );
      expect(recorded.mails[0].html).toContain(
        `まだ確定していない「${TOURNAMENT_NAME}」へのエントリーは`,
      );
      expect(recorded.mails[0].html).toContain('取り消しました');
    });

    it('says nothing of a withdrawal when the takeover withdrew nothing', async () => {
      const recorded = await takenOver({
        regulationsWriteErrorCode: FOREIGN_KEY_VIOLATION_SQLSTATE,
      });

      await postQuietly();

      expect(recorded.mails).toHaveLength(1);
      expect(recorded.mails[0].html).not.toContain('取り消しました');
    });

    it('carries them in a deferred notice', async () => {
      await takenOver({
        withdrawn: [OTHER_TOURNAMENT_ID, TOURNAMENT_ID],
        regulationsWriteErrorCode: FOREIGN_KEY_VIOLATION_SQLSTATE,
      });
      const queue = new RecordingQueue<BulkMailMessage>();

      await postQuietly({
        ...env,
        MAIL_TRIGGER_EMAIL_RATE_LIMITER: refusingRateLimiter(),
        BULK_MAIL_QUEUE: queue,
      });

      // The mock answers every tournament lookup with this tournament's
      // row, so the other one reads under this one's name as well.
      expect(queue.sent).toEqual([
        {
          kind: 'deferred-notice',
          to: validBody.email,
          tournamentName: TOURNAMENT_NAME,
          reason: 'regulation-unavailable',
          withdrawnTournaments: [TOURNAMENT_NAME, TOURNAMENT_NAME],
        },
      ]);
    });
  });

  it('enters an unverified account under its own password and region without a takeover', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant({verified: false}),
    });

    await postWithContext(TOURNAMENT_PATH, validBody);
    await settleBackgroundWork();

    expect(recorded.takeOvers).toHaveLength(0);
    expect(recorded.calls).toContainEqual({table: 'entries', method: 'POST'});
    expect(recorded.mails[0].subject).toBe(
      verificationMailSubject(TOURNAMENT_NAME),
    );
  });

  // Regions using different question sets (宮崎 and 鹿児島) can be entered
  // together: a second entry before following the first link is a further
  // entry, not a takeover that would withdraw the first.
  it('enters an unverified account under its own password in a region it may also enter', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant({
        verified: false,
      }),
    });

    await postWithContext(TOURNAMENT_PATH, validBody);
    await settleBackgroundWork();

    // Lapsed before the write, so a pending entry whose link expired doesn't
    // count for the trigger.
    const tables = recorded.calls.map(call => call.table);
    expect(tables.indexOf('rpc/lapse_expired_pending_entries')).toBeLessThan(
      tables.indexOf('entries'),
    );
    expect(recorded.takeOvers).toHaveLength(0);
    expect(recorded.calls).toContainEqual({table: 'entries', method: 'POST'});
    expect(recorded.mails[0].subject).toBe(
      verificationMailSubject(TOURNAMENT_NAME),
    );
  });

  // A takeover would delete every entry of the account, including those
  // this tournament doesn't conflict with: refused instead, like a verified
  // account would be.
  it('refuses an unverified account under its own password in a region on the same question set', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant({
        verified: false,
      }),
      entryWriteErrorCode: PARTICIPANT_REGION_SQLSTATE,
    });

    const res = await observable(
      await postWithContext(TOURNAMENT_PATH, validBody),
    );
    await settleBackgroundWork();

    expect(res).toEqual({status: 202, body: JSON.stringify({ok: true})});
    expect(recorded.takeOvers).toHaveLength(0);
    // The refused write left nothing behind, so there is nothing to undo.
    expect(recorded.calls).not.toContainEqual({
      table: 'entries',
      method: 'DELETE',
    });
    expect(recorded.mails).toHaveLength(1);
    expect(recorded.mails[0].subject).toBe(entryNoticeSubject(TOURNAMENT_NAME));
    expect(recorded.mails[0].html).toContain('同じ問題を使う別の地域の大会');
  });

  it('holds a takeover to the rules for setting a password', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant({verified: false}),
    });

    await postWithContext(TOURNAMENT_PATH, {
      ...validBody,
      password: 'Password123',
      passwordConfirm: 'Password123',
    });
    await settleBackgroundWork();

    expect(recorded.takeOvers).toHaveLength(0);
    expect(recorded.mails).toHaveLength(1);
    expect(recorded.mails[0].html).toContain('よく使われている');
  });

  // The owner followed a link between the lookup and the takeover, so the
  // account is theirs, and the submission has to prove it like any other.
  it('falls back to the password check when the address was verified meanwhile', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant({
        password: 'the-real-one',
        verified: false,
      }),
      takeOver: false,
    });

    await postWithContext(TOURNAMENT_PATH, validBody);
    await settleBackgroundWork();

    expect(recorded.takeOvers).toHaveLength(1);
    expect(recorded.calls).not.toContainEqual({
      table: 'entries',
      method: 'POST',
    });
    expect(recorded.mails).toHaveLength(1);
    expect(recorded.mails[0].subject).toBe(entryNoticeSubject(TOURNAMENT_NAME));
    expect(recorded.mails[0].html).toContain('パスワード');
  });

  // Another submission took the account over and had its link followed
  // between this one's lookup and its takeover, so what decides is the
  // account as it is now, not the row read before.
  it('holds a refused takeover to the account as it is now', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant({
        password: 'someone-elses-password',
        verified: false,
      }),
      takeOver: false,
      verifiedMeanwhile: await registeredParticipant(),
    });

    await postWithContext(TOURNAMENT_PATH, validBody);
    await settleBackgroundWork();

    expect(recorded.takeOvers).toHaveLength(1);
    expect(recorded.calls).toContainEqual({table: 'entries', method: 'POST'});
    expect(recorded.mails).toHaveLength(1);
    expect(recorded.mails[0].subject).toBe(
      verificationMailSubject(TOURNAMENT_NAME),
    );
  });

  it('never takes over a verified account', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant(),
      entryWriteErrorCode: PARTICIPANT_REGION_SQLSTATE,
    });

    await postWithContext(TOURNAMENT_PATH, validBody);
    await settleBackgroundWork();

    expect(recorded.takeOvers).toHaveLength(0);
    expect(recorded.mails[0].html).toContain('別の地域');
  });

  // #243: a priority phase closes because staff marked it to.
  describe('with a priority phase that is over', () => {
    const closesAt = new Date(Date.now() + DAY_MS * 2).toISOString();
    const priorityEndedAt = new Date(Date.now() - 1000).toISOString();
    const earlierPhase = (id: string) => ({
      id,
      priority_starts_at: new Date(Date.now() - DAY_MS / 2).toISOString(),
      priority_ends_at: priorityEndedAt,
      closes_with_priority: true,
    });
    const general = {
      id: '99999999-9999-4999-8999-999999999999',
      priority_starts_at: null,
      priority_ends_at: null,
      closes_with_priority: false,
    };
    // A window that opens as the phase ends, on a regulation that stays.
    const laterWindow = (endsAt: string) => ({
      ...general,
      priority_starts_at: priorityEndedAt,
      priority_ends_at: endsAt,
    });
    const selectedWithoutWindow = {
      id: validBody.regulationIds[0],
      priority_starts_at: null,
      priority_ends_at: null,
      closes_with_priority: false,
    };
    const otherPhaseId = '88888888-8888-4888-8888-888888888888';

    it('enforces a later window when nothing is marked to close', async () => {
      mockSupabase({
        tournament: tournamentRow({
          entryClosesAt: closesAt,
          regulations: [
            selectedWithoutWindow,
            {...earlierPhase(otherPhaseId), closes_with_priority: false},
            laterWindow(new Date(Date.now() + DAY_MS).toISOString()),
          ],
        }),
        participant: null,
      });

      const res = await postWithContext(TOURNAMENT_PATH, validBody);
      await settleBackgroundWork();

      expect(res.status).toBe(403);
    });

    // #262: before, a window that followed a marked phase restricted nobody.
    it('enforces a later window after a phase marked to close too', async () => {
      mockSupabase({
        tournament: tournamentRow({
          entryClosesAt: closesAt,
          regulations: [
            selectedWithoutWindow,
            earlierPhase(otherPhaseId),
            laterWindow(closesAt),
          ],
        }),
        participant: null,
      });

      const res = await postWithContext(TOURNAMENT_PATH, validBody);
      await settleBackgroundWork();

      expect(res.status).toBe(403);
    });

    it('accepts what is on offer in the general phase', async () => {
      mockSupabase({
        tournament: tournamentRow({
          entryClosesAt: closesAt,
          regulations: [
            selectedWithoutWindow,
            earlierPhase(otherPhaseId),
            general,
          ],
        }),
        participant: null,
      });

      const res = await postWithContext(TOURNAMENT_PATH, validBody);
      await settleBackgroundWork();

      expect(res.status).toBe(202);
    });

    it('refuses the phase that is over in the general phase', async () => {
      const recorded = mockSupabase({
        tournament: tournamentRow({
          entryClosesAt: closesAt,
          regulations: [earlierPhase(validBody.regulationIds[0]), general],
        }),
        participant: null,
      });

      const res = await postWithContext(TOURNAMENT_PATH, validBody);
      await settleBackgroundWork();

      expect(res.status).toBe(409);
      expect((await res.json()) as unknown).toEqual({
        error: 'regulation no longer available',
      });
      expect(recorded.calls).not.toContainEqual({
        table: 'entries',
        method: 'POST',
      });
    });

    // A foreign id alongside the phase that is over is what a form left open
    // sends when staff also removed a regulation: the 409 is what makes it
    // read the regulations again.
    it('answers 409 for the phase that is over next to a foreign id', async () => {
      mockSupabase({
        tournament: tournamentRow({
          entryClosesAt: closesAt,
          regulations: [earlierPhase(validBody.regulationIds[0]), general],
        }),
        participant: null,
      });

      const res = await postWithContext(TOURNAMENT_PATH, {
        ...validBody,
        regulationIds: [otherPhaseId, validBody.regulationIds[0]],
      });
      await settleBackgroundWork();

      expect(res.status).toBe(409);
      expect((await res.json()) as unknown).toEqual({
        error: 'regulation no longer available',
      });
    });

    // A form left open across a staff deletion sends exactly this. The 409 is
    // what makes it read the regulations again; a 403 would only repeat.
    it('answers 409 for a regulation that no longer exists', async () => {
      mockSupabase({
        tournament: tournamentRow({
          entryClosesAt: closesAt,
          regulations: [earlierPhase(validBody.regulationIds[0]), general],
        }),
        participant: null,
      });

      const res = await postWithContext(TOURNAMENT_PATH, {
        ...validBody,
        regulationIds: [otherPhaseId],
      });
      await settleBackgroundWork();

      expect(res.status).toBe(409);
      expect((await res.json()) as unknown).toEqual({
        error: 'regulation no longer available',
      });
    });
  });

  it('refuses a new entry while staff have paused the tournament', async () => {
    const recorded = mockSupabase({
      tournament: tournamentRow({entriesPaused: true}),
      participant: null,
    });

    const res = await postWithContext(TOURNAMENT_PATH, validBody);
    await settleBackgroundWork();

    expect(res.status).toBe(403);
    expect((await res.json()) as unknown).toEqual({error: 'entries paused'});
    expect(recorded.calls).not.toContainEqual({
      table: 'entries',
      method: 'POST',
    });
    expect(recorded.mails).toHaveLength(0);
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

  describe.each([
    ['a first entry', undefined, 'entries'],
    ['a re-entry', CANCELLED_ENTRY, 'rpc/reenter_cancelled_entry'],
  ])('refused by the dual-entry trigger on %s', (_, cancelledEntry, table) => {
    it('mails the owner and leaves nothing else behind', async () => {
      const recorded = mockSupabase({
        participant: await registeredParticipant(),
        entryWriteErrorCode: REGION_DUAL_ENTRY_SQLSTATE,
        cancelledEntry,
      });

      const res = await observable(
        await postWithContext(TOURNAMENT_PATH, validBody),
      );
      await settleBackgroundWork();

      expect(res).toEqual({status: 202, body: JSON.stringify({ok: true})});
      expect(recorded.mails).toHaveLength(1);
      expect(recorded.mails[0].subject).toBe(
        entryNoticeSubject(TOURNAMENT_NAME),
      );
      expect(recorded.mails[0].html).toContain('もう一方の大会');
      // The write is the last thing tried: nothing follows it, and with no
      // row written there is nothing to roll back.
      expect(recorded.calls.at(-1)).toEqual({table, method: 'POST'});
    });
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
      subject: verificationMailSubject(TOURNAMENT_NAME),
    });
  });

  // The session has already proved who is asking, so telling them leaks
  // nothing they don't know.
  it('still reports errors directly for a logged-in participant', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant(),
      entryWriteErrorCode: PARTICIPANT_REGION_SQLSTATE,
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

  it('enters a participant with nothing left in their old region (#236)', async () => {
    const recorded = mockSupabase({
      participant: await registeredParticipant(),
    });

    const res = await postWithContext(
      SESSION_PATH,
      sessionBody,
      await sessionCookie(),
    );

    expect(res.status).toBe(201);
    expect(recorded.calls).toContainEqual({table: 'entries', method: 'POST'});
  });

  it('reports a regulation taken off the offer directly', async () => {
    const closesAt = new Date(Date.now() + DAY_MS * 2).toISOString();
    const priorityEndedAt = new Date(Date.now() - 1000).toISOString();
    mockSupabase({
      tournament: tournamentRow({
        entryClosesAt: closesAt,
        regulations: [
          {
            id: validBody.regulationIds[0],
            priority_starts_at: new Date(Date.now() - DAY_MS / 2).toISOString(),
            priority_ends_at: priorityEndedAt,
            closes_with_priority: true,
          },
          {
            id: '99999999-9999-4999-8999-999999999999',
            priority_starts_at: priorityEndedAt,
            priority_ends_at: closesAt,
            closes_with_priority: false,
          },
        ],
      }),
      participant: await registeredParticipant(),
    });

    const res = await postWithContext(
      SESSION_PATH,
      sessionBody,
      await sessionCookie(),
    );

    expect(res.status).toBe(409);
    expect((await res.json()) as unknown).toEqual({
      error: 'regulation no longer available',
    });
  });

  describe('re-entering a cancelled entry', () => {
    it('writes through the RPC rather than to the table', async () => {
      const recorded = mockSupabase({
        participant: await registeredParticipant(),
        cancelledEntry: CANCELLED_ENTRY,
      });

      const res = await postWithContext(
        SESSION_PATH,
        sessionBody,
        await sessionCookie(),
      );

      expect(res.status).toBe(201);
      expect(recorded.reentries).toEqual([
        {
          p_entry_id: ENTRY_ID,
          p_participant_id: PARTICIPANT_ID,
          p_name: sessionBody.name,
          p_furigana: sessionBody.furigana,
          p_display_name: sessionBody.displayName,
          p_free_text: null,
          p_custom_field_values: sessionBody.customFieldValues,
        },
      ]);
      expect(
        recorded.calls.filter(
          call => call.table === 'entries' && call.method !== 'GET',
        ),
      ).toEqual([]);
    });

    it.each([
      [
        REGION_DUAL_ENTRY_SQLSTATE,
        'already entered another tournament in this region',
      ],
      [PARTICIPANT_REGION_SQLSTATE, 'already registered in another region'],
    ])(
      'answers %s from the trigger like a first entry',
      async (code, error) => {
        mockSupabase({
          participant: await registeredParticipant(),
          cancelledEntry: CANCELLED_ENTRY,
          entryWriteErrorCode: code,
        });

        const res = await postWithContext(
          SESSION_PATH,
          sessionBody,
          await sessionCookie(),
        );

        expect(res.status).toBe(409);
        expect((await res.json()) as unknown).toEqual({error});
      },
    );

    it('answers a row taken in the meantime as a concurrent submission', async () => {
      mockSupabase({
        participant: await registeredParticipant(),
        cancelledEntry: CANCELLED_ENTRY,
        reentryMatchesNoRow: true,
      });

      const res = await postWithContext(
        SESSION_PATH,
        sessionBody,
        await sessionCookie(),
      );

      expect(res.status).toBe(409);
      expect((await res.json()) as unknown).toEqual({
        error: 'concurrent submission',
      });
    });
  });

  // Since 0043 the trigger refuses for a seat that is really held in another
  // region on the same question set: retrying won't help.
  it('answers P0008 from the trigger as taking part in another region', async () => {
    mockSupabase({
      participant: await registeredParticipant(),
      entryWriteErrorCode: PARTICIPANT_REGION_SQLSTATE,
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
  });

  describe.each([
    ['a first entry', undefined],
    ['a re-entry', CANCELLED_ENTRY],
  ])('refused by the dual-entry trigger on %s', (_, cancelledEntry) => {
    it('answers 409 and mails nothing', async () => {
      const recorded = mockSupabase({
        participant: await registeredParticipant(),
        entryWriteErrorCode: REGION_DUAL_ENTRY_SQLSTATE,
        cancelledEntry,
      });

      const res = await postWithContext(
        SESSION_PATH,
        sessionBody,
        await sessionCookie(),
      );

      expect(res.status).toBe(409);
      expect((await res.json()) as unknown).toEqual({
        error: 'already entered another tournament in this region',
      });
      expect(recorded.mails).toHaveLength(0);
    });
  });
});
