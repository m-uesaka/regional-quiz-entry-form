import {afterEach, describe, expect, it} from 'bun:test';
import {sign} from 'hono/jwt';
import type {Bindings} from '../types/env';
import {app} from '../index';
import type {BulkMailMessage} from '../lib/bulk-mail-queue';
import {
  PERMISSIVE_PLATFORM_BINDINGS,
  RecordingQueue,
} from '../test-support/bindings';
import {ENQUEUE_BATCH_SIZE} from './staff-mail';

const SESSION_SECRET = 'test-session-secret';

const REGION_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_REGION_ID = '22222222-2222-2222-2222-222222222222';
const TOURNAMENT_ID = '44444444-4444-4444-4444-444444444444';
const JOB_ID = '55555555-5555-5555-5555-555555555555';

const MAIL_INPUT = {subject: '大会のご案内', body: '<p>お待ちしています</p>'};

async function regionalStaffCookie(regionId = REGION_ID): Promise<string> {
  const token = await sign(
    {
      sub: '88888888-8888-8888-8888-888888888888',
      role: 'regional',
      regionId,
      tournamentType: 'saikyoi',
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    SESSION_SECRET,
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
    SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

/** The queue each request's env carries, so a test can read what it took. */
let queue = new RecordingQueue<BulkMailMessage>();

function env(): Bindings {
  return {
    ...PERMISSIVE_PLATFORM_BINDINGS,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
    MAIL_API_KEY: 'dummy-mail-api-key',
    GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
    MAIL_FROM_ADDRESS: 'entry@example.com',
    FRONTEND_URL: 'https://entry.example.com',
    SESSION_SECRET,
    BULK_MAIL_QUEUE: queue,
  };
}

const EXECUTION_CTX = {
  waitUntil(): void {},
  passThroughOnException(): void {},
} as unknown as ExecutionContext;

/** A `mail_jobs` row as the progress endpoint selects it. */
function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    tournament_id: TOURNAMENT_ID,
    subject: MAIL_INPUT.subject,
    body_html: MAIL_INPUT.body,
    total: 3,
    sent: 2,
    failed: 1,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:01:00Z',
    ...overrides,
  };
}

interface StubbedResponses {
  /** The tournament the scope check finds, for regional staff. */
  tournament?: unknown;
  /** The `entries` pages the recipient query reads, in order. */
  entries?: unknown[];
  /** What the `mail_jobs` insert answers with. */
  createdJob?: unknown;
  /** What the `mail_jobs` select answers with. */
  jobs?: unknown;
}

interface FetchLog {
  entryQueries: string[];
  insertedJobs: Array<Record<string, unknown>>;
  progress: Array<Record<string, unknown>>;
}

/**
 * Mocks the Supabase REST calls the route makes, dispatching on the table
 * in the URL rather than on call order: the scope check, the paged
 * recipient query, the `mail_jobs` insert and select, and the progress
 * function. Any entry of `responses` may be a ready-made `Response` to
 * simulate a failing query.
 *
 * No mail provider stub is needed any more -- the route enqueues the
 * recipients and answers, and the sending belongs to the queue consumer
 * (`lib/bulk-mail-queue.ts`), so a send leaving this process would be a
 * bug.
 */
function mockFetch(responses: StubbedResponses = {}): FetchLog {
  const log: FetchLog = {entryQueries: [], insertedJobs: [], progress: []};
  const entryPages = [...(responses.entries ?? [[]])];

  const answer = (body: unknown) =>
    Promise.resolve(
      body instanceof Response ? body.clone() : Response.json(body),
    );

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (url.includes('/rest/v1/tournaments')) {
      return answer(responses.tournament ?? []);
    }
    if (url.includes('/rest/v1/entries')) {
      log.entryQueries.push(url);
      return answer(entryPages.shift() ?? []);
    }
    if (url.includes('/rpc/record_mail_job_progress')) {
      log.progress.push(
        JSON.parse(String(init?.body)) as Record<string, unknown>,
      );
      return answer(null);
    }
    if (url.includes('/rest/v1/mail_jobs')) {
      if (init?.method === 'POST') {
        log.insertedJobs.push(
          JSON.parse(String(init.body)) as Record<string, unknown>,
        );
        return answer(responses.createdJob ?? {id: JOB_ID});
      }
      return answer(responses.jobs ?? [jobRow()]);
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as unknown as typeof fetch;

  return log;
}

const IN_SCOPE_TOURNAMENT = [{region_id: REGION_ID, type: 'saikyoi'}];

function entryRow(email: string): {participants: {email: string}} {
  return {participants: {email}};
}

/** `count` distinct recipients, as `entries` rows. */
function entryRows(count: number): Array<{participants: {email: string}}> {
  return Array.from({length: count}, (unusedValue, index) =>
    entryRow(`user${index}@example.com`),
  );
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
    env(),
    EXECUTION_CTX,
  );
}

async function getMailJob(
  cookie: string | undefined,
  jobId = JOB_ID,
): Promise<Response> {
  return app.request(
    `/api/staff/tournaments/${TOURNAMENT_ID}/mail/${jobId}`,
    {headers: {...(cookie ? {cookie} : {})}},
    env(),
    EXECUTION_CTX,
  );
}

describe('POST /staff/tournaments/:tournamentId/mail', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    queue = new RecordingQueue<BulkMailMessage>();
  });

  it('returns 401 without a staff session', async () => {
    mockFetch();

    const res = await postMail(undefined);

    expect(res.status).toBe(401);
    expect(queue.sent).toEqual([]);
  });

  it('enqueues one message per recipient', async () => {
    mockFetch({
      tournament: IN_SCOPE_TOURNAMENT,
      entries: [[entryRow('taro@example.com'), entryRow('hanako@example.com')]],
    });
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie);
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toEqual({jobId: JOB_ID, accepted: 2});
    // One message per address, each naming the job it belongs to -- the
    // subject and body stay in the `mail_jobs` row, which is what keeps a
    // message inside the queue's size limits.
    expect(queue.sent).toEqual([
      {jobId: JOB_ID, to: 'taro@example.com'},
      {jobId: JOB_ID, to: 'hanako@example.com'},
    ]);
  });

  it('records the send as a job before enqueueing it', async () => {
    const log = mockFetch({
      tournament: IN_SCOPE_TOURNAMENT,
      entries: [[entryRow('taro@example.com'), entryRow('hanako@example.com')]],
    });
    const cookie = await regionalStaffCookie();

    await postMail(cookie);

    // The row carries the content the consumer sends and the number of
    // recipients its counters have to reach.
    expect(log.insertedJobs).toEqual([
      {
        tournament_id: TOURNAMENT_ID,
        subject: MAIL_INPUT.subject,
        body_html: MAIL_INPUT.body,
        total: 2,
      },
    ]);
  });

  it('no longer refuses a list over 80 recipients', async () => {
    const recipientCount = 250;
    mockFetch({
      tournament: IN_SCOPE_TOURNAMENT,
      entries: [entryRows(recipientCount)],
    });
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie);
    const body = await res.json();

    // The old ceiling was 80: what a paced send could finish inside the
    // ~30 seconds of post-response time. The consumer is not on that
    // clock, so the whole list is accepted (Task 10-4).
    expect(res.status).toBe(202);
    expect(body).toEqual({jobId: JOB_ID, accepted: recipientCount});
    expect(queue.sent).toHaveLength(recipientCount);
    // Split into calls of at most `ENQUEUE_BATCH_SIZE`, which is
    // Cloudflare's own cap on a `sendBatch()`.
    expect(queue.callSizes).toEqual([
      ENQUEUE_BATCH_SIZE,
      ENQUEUE_BATCH_SIZE,
      recipientCount - 2 * ENQUEUE_BATCH_SIZE,
    ]);
  });

  it('sends only to entries matching statusFilter', async () => {
    const log = mockFetch({
      tournament: IN_SCOPE_TOURNAMENT,
      entries: [[entryRow('taro@example.com')]],
    });
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie, {
      ...MAIL_INPUT,
      statusFilter: 'confirmed',
    });

    expect(res.status).toBe(202);
    expect(log.entryQueries[0]).toContain('status=eq.confirmed');
    expect(queue.sent.map(message => message.to)).toEqual(['taro@example.com']);
  });

  it('sends to all but cancelled entries when no statusFilter is given', async () => {
    const log = mockFetch({
      tournament: IN_SCOPE_TOURNAMENT,
      entries: [[entryRow('taro@example.com')]],
    });
    const cookie = await regionalStaffCookie();

    await postMail(cookie);

    // Cancelled entries are left out unless they are asked for by name.
    expect(log.entryQueries[0]).toContain('status=neq.cancelled');
  });

  it('returns 403 for staff outside their scope', async () => {
    mockFetch({tournament: [{region_id: OTHER_REGION_ID, type: 'saikyoi'}]});
    const cookie = await regionalStaffCookie(REGION_ID);

    const res = await postMail(cookie);

    expect(res.status).toBe(403);
    expect(queue.sent).toEqual([]);
  });

  it('allows general staff for any tournament', async () => {
    mockFetch({entries: [[entryRow('taro@example.com')]]});
    const cookie = await generalStaffCookie();

    const res = await postMail(cookie);

    expect(res.status).toBe(202);
    expect(queue.sent.map(message => message.to)).toEqual(['taro@example.com']);
  });

  it('mails a participant once even with several matching entry rows', async () => {
    mockFetch({
      tournament: IN_SCOPE_TOURNAMENT,
      entries: [
        [
          entryRow('taro@example.com'),
          entryRow('taro@example.com'),
          {participants: null},
        ],
      ],
    });
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie);
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toEqual({jobId: JOB_ID, accepted: 1});
    expect(queue.sent).toHaveLength(1);
  });

  it('returns 400 for an empty subject', async () => {
    mockFetch({tournament: IN_SCOPE_TOURNAMENT});
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie, {...MAIL_INPUT, subject: ''});

    expect(res.status).toBe(400);
    expect(queue.sent).toEqual([]);
  });

  it('returns 400 for an unknown statusFilter', async () => {
    mockFetch({tournament: IN_SCOPE_TOURNAMENT});
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie, {...MAIL_INPUT, statusFilter: 'nope'});

    expect(res.status).toBe(400);
    expect(queue.sent).toEqual([]);
  });

  it('returns 500 without enqueueing when the recipient query fails', async () => {
    mockFetch({
      tournament: IN_SCOPE_TOURNAMENT,
      entries: [Response.json({message: 'db is down'}, {status: 500})],
    });
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({error: 'internal server error'});
    expect(queue.sent).toEqual([]);
  });

  it('returns 500 without enqueueing when the job cannot be recorded', async () => {
    mockFetch({
      tournament: IN_SCOPE_TOURNAMENT,
      entries: [[entryRow('taro@example.com')]],
      createdJob: Response.json({message: 'db is down'}, {status: 500}),
    });
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie);

    // Without a job row there is nothing for the consumer to read the
    // subject and body out of, so the messages would be undeliverable.
    expect(res.status).toBe(500);
    expect(queue.sent).toEqual([]);
  });

  it('books the recipients it could not enqueue as failures', async () => {
    const log = mockFetch({
      tournament: IN_SCOPE_TOURNAMENT,
      entries: [entryRows(ENQUEUE_BATCH_SIZE + 10)],
    });
    // The second `sendBatch()` call is refused, after the first went out.
    queue.failingCallIndex = 1;
    const cookie = await regionalStaffCookie();

    const res = await postMail(cookie);

    expect(res.status).toBe(500);
    // The job would otherwise sit at `sent + failed < total` for good and
    // read as a send that is still running.
    expect(log.progress).toEqual([{p_job_id: JOB_ID, p_sent: 0, p_failed: 10}]);
    // The first chunk is already on its way, so the caller has to be able
    // to read the job back before re-sending -- which takes the id, and
    // nothing else hands it out.
    const body = await res.json();
    expect(body).toEqual({error: 'internal server error', jobId: JOB_ID});
  });
});

describe('GET /staff/tournaments/:tournamentId/mail/:jobId', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    queue = new RecordingQueue<BulkMailMessage>();
  });

  it('returns 401 without a staff session', async () => {
    mockFetch();

    const res = await getMailJob(undefined);

    expect(res.status).toBe(401);
  });

  it('reports how much of the send has gone out', async () => {
    mockFetch({tournament: IN_SCOPE_TOURNAMENT, jobs: [jobRow()]});
    const cookie = await regionalStaffCookie();

    const res = await getMailJob(cookie);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      jobId: JOB_ID,
      subject: MAIL_INPUT.subject,
      total: 3,
      sent: 2,
      failed: 1,
      createdAt: '2026-08-29T00:00:00Z',
      updatedAt: '2026-08-29T00:01:00Z',
    });
  });

  it('leaves the composed body out of the response', async () => {
    mockFetch({tournament: IN_SCOPE_TOURNAMENT, jobs: [jobRow()]});
    const cookie = await regionalStaffCookie();

    const res = await getMailJob(cookie);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).not.toHaveProperty('bodyHtml');
  });

  it('returns 404 for a job of another tournament', async () => {
    // The lookup is scoped by tournament as well as by id, so such a row
    // simply doesn't come back.
    mockFetch({tournament: IN_SCOPE_TOURNAMENT, jobs: []});
    const cookie = await regionalStaffCookie();

    const res = await getMailJob(cookie);

    expect(res.status).toBe(404);
  });

  it('returns 400 for a job id that is not a uuid', async () => {
    mockFetch({tournament: IN_SCOPE_TOURNAMENT});
    const cookie = await regionalStaffCookie();

    const res = await getMailJob(cookie, 'not-a-uuid');

    expect(res.status).toBe(400);
  });

  it('returns 403 for staff outside their scope', async () => {
    mockFetch({tournament: [{region_id: OTHER_REGION_ID, type: 'saikyoi'}]});
    const cookie = await regionalStaffCookie(REGION_ID);

    const res = await getMailJob(cookie);

    expect(res.status).toBe(403);
  });

  it('returns 500 when the job cannot be read', async () => {
    mockFetch({
      tournament: IN_SCOPE_TOURNAMENT,
      jobs: Response.json({message: 'db is down'}, {status: 500}),
    });
    const cookie = await regionalStaffCookie();

    const res = await getMailJob(cookie);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({error: 'internal server error'});
  });
});
