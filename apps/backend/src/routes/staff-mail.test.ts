import {afterEach, describe, expect, it} from 'bun:test';
import {sign} from 'hono/jwt';
import type {Bindings} from '../types/env';
import app from '../index';
import {MAIL_BATCH_SIZE} from '../lib/bulk-mail';

const ENV: Bindings = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

const REGION_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_REGION_ID = '22222222-2222-2222-2222-222222222222';
const TOURNAMENT_ID = '44444444-4444-4444-4444-444444444444';

const MAIL_INPUT = {subject: '大会のご案内', body: '<p>お待ちしています</p>'};

const IN_SCOPE_TOURNAMENT = [{region_id: REGION_ID, type: 'saikyoi'}];

async function regionalStaffCookie(regionId = REGION_ID): Promise<string> {
  const token = await sign(
    {
      sub: '88888888-8888-8888-8888-888888888888',
      role: 'regional',
      regionId,
      tournamentType: 'saikyoi',
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    ENV.SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

async function generalStaffCookie(): Promise<string> {
  const token = await sign(
    {
      sub: '99999999-9999-9999-9999-999999999999',
      role: 'general',
      regionId: null,
      tournamentType: null,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    ENV.SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

// What the route deferred with `waitUntil()`. Cloudflare runs these after
// the response; here they are collected so a test can await them explicitly
// instead of leaking into the next one.
let backgroundWork: Array<Promise<unknown>> = [];

const EXECUTION_CTX = {
  waitUntil(promise: Promise<unknown>): void {
    backgroundWork.push(promise);
  },
  passThroughOnException(): void {},
} as unknown as ExecutionContext;

/** Runs the send the route deferred, the way the Workers runtime would. */
async function settleBackgroundWork(): Promise<void> {
  const pending = backgroundWork;
  backgroundWork = [];
  await Promise.all(pending);
}

interface SentMail {
  from: string;
  to: string;
  subject: string;
  html: string;
}

interface FetchLog {
  supabaseUrls: string[];
  mails: SentMail[];
}

/**
 * Mocks both `fetch` targets the route talks to: Supabase's REST API,
 * whose calls are answered from `supabaseResponses` in order (the scope
 * lookup made by `requireStaffForTournament()` for regional staff first,
 * then one call per page of recipients), and the Resend API, whose calls
 * are recorded and answered with a success. A `supabaseResponses` entry may
 * be a ready-made `Response` to simulate a failing query; anything else is
 * returned as a successful JSON body. Addresses listed in
 * `rejectedRecipients` get a provider error instead.
 */
function mockFetch(
  supabaseResponses: unknown[],
  rejectedRecipients: readonly string[] = [],
): FetchLog {
  const log: FetchLog = {supabaseUrls: [], mails: []};
  let supabaseCallIndex = 0;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (url.startsWith('https://api.resend.com/')) {
      const mail = JSON.parse(String(init?.body)) as SentMail;
      log.mails.push(mail);
      if (rejectedRecipients.includes(mail.to)) {
        return Promise.resolve(new Response(null, {status: 422}));
      }
      return Promise.resolve(Response.json({id: 'mail-id'}));
    }

    log.supabaseUrls.push(url);
    const response = supabaseResponses[supabaseCallIndex] ?? [];
    supabaseCallIndex++;
    return Promise.resolve(
      response instanceof Response ? response : Response.json(response),
    );
  }) as unknown as typeof fetch;

  return log;
}

function entryRow(email: string): {participants: {email: string}} {
  return {participants: {email}};
}

async function postMail(
  cookie: string | undefined,
  body: Record<string, unknown> = MAIL_INPUT,
): Promise<Response> {
  return app.request(
    `/api/staff/tournaments/${TOURNAMENT_ID}/mail`,
    {
      method: 'POST',
      headers: {
        ...(cookie ? {cookie} : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    ENV,
    EXECUTION_CTX,
  );
}

describe('POST /staff/tournaments/:tournamentId/mail', () => {
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    await settleBackgroundWork();
    globalThis.fetch = originalFetch;
  });

  it('returns 401 without a staff session', async () => {
    const log = mockFetch([]);

    const res = await postMail(undefined);

    expect(res.status).toBe(401);
    expect(log.mails).toEqual([]);
  });

  it('sends to all entries when no statusFilter is given', async () => {
    const log = mockFetch([
      IN_SCOPE_TOURNAMENT,
      [entryRow('taro@example.com'), entryRow('hanako@example.com')],
    ]);
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie);
    const body = await res.json();
    await settleBackgroundWork();

    expect(res.status).toBe(202);
    expect(body).toEqual({accepted: 2});
    expect(log.mails).toEqual([
      {
        from: ENV.MAIL_FROM_ADDRESS,
        to: 'taro@example.com',
        subject: MAIL_INPUT.subject,
        html: MAIL_INPUT.body,
      },
      {
        from: ENV.MAIL_FROM_ADDRESS,
        to: 'hanako@example.com',
        subject: MAIL_INPUT.subject,
        html: MAIL_INPUT.body,
      },
    ]);
    // Cancelled entries are left out unless they are asked for by name.
    expect(log.supabaseUrls[1]).toContain('status=neq.cancelled');
  });

  it('sends only to entries matching statusFilter', async () => {
    const log = mockFetch([
      IN_SCOPE_TOURNAMENT,
      [entryRow('taro@example.com')],
    ]);
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie, {
      ...MAIL_INPUT,
      statusFilter: 'confirmed',
    });
    const body = await res.json();
    await settleBackgroundWork();

    expect(res.status).toBe(202);
    expect(body).toEqual({accepted: 1});
    expect(log.supabaseUrls[1]).toContain('status=eq.confirmed');
    expect(log.mails.map(mail => mail.to)).toEqual(['taro@example.com']);
  });

  it('returns 403 for staff outside their scope', async () => {
    const log = mockFetch([[{region_id: OTHER_REGION_ID, type: 'saikyoi'}]]);
    const cookie = await regionalStaffCookie(REGION_ID);

    const res = await postMail(cookie);
    await settleBackgroundWork();

    expect(res.status).toBe(403);
    expect(log.mails).toEqual([]);
  });

  it('allows general staff for any tournament', async () => {
    const log = mockFetch([[entryRow('taro@example.com')]]);
    const cookie = await generalStaffCookie();

    const res = await postMail(cookie);
    await settleBackgroundWork();

    expect(res.status).toBe(202);
    expect(log.mails.map(mail => mail.to)).toEqual(['taro@example.com']);
  });

  it('mails every recipient past the first rate-control batch', async () => {
    const recipients = Array.from(
      {length: MAIL_BATCH_SIZE + 1},
      (unusedValue, index) => `user${index}@example.com`,
    );
    const log = mockFetch([IN_SCOPE_TOURNAMENT, recipients.map(entryRow)]);
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie);
    const body = await res.json();
    await settleBackgroundWork();

    expect(res.status).toBe(202);
    expect(body).toEqual({accepted: recipients.length});
    expect(log.mails.map(mail => mail.to)).toEqual(recipients);
  });

  it('answers without waiting for the rate-controlled tail of the send', async () => {
    const recipients = Array.from(
      {length: MAIL_BATCH_SIZE + 1},
      (unusedValue, index) => `user${index}@example.com`,
    );
    const log = mockFetch([IN_SCOPE_TOURNAMENT, recipients.map(entryRow)]);
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie);

    expect(res.status).toBe(202);
    // The batches after the first are spaced by `MAIL_BATCH_INTERVAL_MS`;
    // the response comes back rather than waiting them out.
    expect(log.mails.length).toBeLessThan(recipients.length);

    await settleBackgroundWork();

    expect(log.mails).toHaveLength(recipients.length);
  });

  it('mails a participant once even with several matching entry rows', async () => {
    const log = mockFetch([
      IN_SCOPE_TOURNAMENT,
      [
        entryRow('taro@example.com'),
        entryRow('taro@example.com'),
        {participants: null},
      ],
    ]);
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie);
    const body = await res.json();
    await settleBackgroundWork();

    expect(res.status).toBe(202);
    expect(body).toEqual({accepted: 1});
    expect(log.mails).toHaveLength(1);
  });

  it('mails the remaining recipients when one is rejected', async () => {
    const log = mockFetch(
      [
        IN_SCOPE_TOURNAMENT,
        [entryRow('taro@example.com'), entryRow('hanako@example.com')],
      ],
      ['taro@example.com'],
    );
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie);
    await settleBackgroundWork();

    expect(res.status).toBe(202);
    expect(log.mails.map(mail => mail.to)).toEqual([
      'taro@example.com',
      'hanako@example.com',
    ]);
  });

  it('returns 400 for an empty subject', async () => {
    const log = mockFetch([IN_SCOPE_TOURNAMENT]);
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie, {...MAIL_INPUT, subject: ''});
    await settleBackgroundWork();

    expect(res.status).toBe(400);
    expect(log.mails).toEqual([]);
  });

  it('returns 400 for an unknown statusFilter', async () => {
    const log = mockFetch([IN_SCOPE_TOURNAMENT]);
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie, {...MAIL_INPUT, statusFilter: 'nope'});
    await settleBackgroundWork();

    expect(res.status).toBe(400);
    expect(log.mails).toEqual([]);
  });

  it('returns 500 without sending when the recipient query fails', async () => {
    const log = mockFetch([
      IN_SCOPE_TOURNAMENT,
      Response.json({message: 'db is down'}, {status: 500}),
    ]);
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie);
    const body = await res.json();
    await settleBackgroundWork();

    expect(res.status).toBe(500);
    expect(body).toEqual({error: 'db is down'});
    expect(log.mails).toEqual([]);
  });
});
