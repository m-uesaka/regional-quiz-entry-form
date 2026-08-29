import {afterEach, describe, expect, it} from 'bun:test';
import type {Bindings} from '../types/env';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';
import {
  MAIL_QUEUE_MAX_ATTEMPTS,
  handleBulkMailQueue,
  type BulkMailMessage,
} from './bulk-mail-queue';

const ENV: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

const JOB_ID = '55555555-5555-5555-5555-555555555555';
const OTHER_JOB_ID = '66666666-6666-6666-6666-666666666666';

/** A `mail_jobs` row as the consumer's content lookup selects it. */
function jobRow(id: string, subject = '大会のご案内') {
  return {id, subject, body_html: `<p>${subject}</p>`};
}

class FakeMessage implements Message<BulkMailMessage> {
  readonly id: string;
  readonly timestamp = new Date();
  acked = false;
  retriedWith: QueueRetryOptions | undefined | 'not retried' = 'not retried';

  constructor(
    readonly body: BulkMailMessage,
    readonly attempts = 1,
  ) {
    this.id = `message-${body.to}`;
  }

  get retried(): boolean {
    return this.retriedWith !== 'not retried';
  }

  ack(): void {
    this.acked = true;
  }

  retry(options?: QueueRetryOptions): void {
    this.retriedWith = options;
  }
}

/** The batch shape the runtime hands the consumer. */
function batchOf(messages: FakeMessage[]): MessageBatch<BulkMailMessage> {
  return {
    queue: 'regional-quiz-bulk-mail-test',
    messages,
    metadata: {metrics: {backlogCount: 0, backlogBytes: 0}},
    retryAll: () => {},
    ackAll: () => {},
  };
}

interface SentMail {
  from: string;
  to: string;
  subject: string;
  html: string;
}

/** One `record_mail_job_progress()` call. */
interface ProgressCall {
  p_job_id: string;
  p_sent: number;
  p_failed: number;
}

interface FetchLog {
  mails: SentMail[];
  progress: ProgressCall[];
  jobLookups: string[];
}

/**
 * Mocks both `fetch` targets the consumer talks to: Supabase, which
 * answers the `mail_jobs` lookups from `jobRows` and records the progress
 * calls, and the Resend API, whose sends are recorded and answered with a
 * success unless the address is listed in `rejected` (a permanent refusal)
 * or `throttled` (a 429).
 * @param jobRows The rows the content lookup finds, or a ready-made
 *     `Response` to simulate a failing query.
 */
function mockFetch(
  jobRows: Array<ReturnType<typeof jobRow>> | Response,
  {
    rejected = [],
    throttled = [],
  }: {rejected?: readonly string[]; throttled?: readonly string[]} = {},
): FetchLog {
  const log: FetchLog = {mails: [], progress: [], jobLookups: []};

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
      if (throttled.includes(mail.to)) {
        return Promise.resolve(new Response(null, {status: 429}));
      }
      if (rejected.includes(mail.to)) {
        return Promise.resolve(new Response(null, {status: 422}));
      }
      return Promise.resolve(Response.json({id: 'mail-id'}));
    }

    if (url.includes('/rpc/record_mail_job_progress')) {
      log.progress.push(JSON.parse(String(init?.body)) as ProgressCall);
      return Promise.resolve(Response.json(null));
    }

    log.jobLookups.push(url);
    if (jobRows instanceof Response) {
      return Promise.resolve(jobRows.clone());
    }
    // The lookup is by id, so only the row it asked for comes back.
    return Promise.resolve(
      Response.json(jobRows.filter(row => url.includes(row.id))),
    );
  }) as unknown as typeof fetch;

  return log;
}

// The retries of a throttled send are `sendPacedMail()`'s own, and they are
// not what these tests are about: without this, every throttled case would
// wait out three backoffs before the consumer got its answer.
const NO_RETRIES = {maxRetries: 0};

describe('handleBulkMailQueue', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends every message in the batch', async () => {
    const log = mockFetch([jobRow(JOB_ID)]);
    const messages = [
      new FakeMessage({jobId: JOB_ID, to: 'taro@example.com'}),
      new FakeMessage({jobId: JOB_ID, to: 'hanako@example.com'}),
    ];

    await handleBulkMailQueue(batchOf(messages), ENV);

    expect(log.mails).toEqual([
      {
        from: ENV.MAIL_FROM_ADDRESS,
        to: 'taro@example.com',
        subject: '大会のご案内',
        html: '<p>大会のご案内</p>',
      },
      {
        from: ENV.MAIL_FROM_ADDRESS,
        to: 'hanako@example.com',
        subject: '大会のご案内',
        html: '<p>大会のご案内</p>',
      },
    ]);
    expect(messages.map(message => message.acked)).toEqual([true, true]);
    // One lookup for the job, not one per recipient: the content is the
    // same row for every message of the send.
    expect(log.jobLookups).toHaveLength(1);
  });

  it('sends each job its own content when a batch mixes two', async () => {
    const log = mockFetch([
      jobRow(JOB_ID, '一つ目'),
      jobRow(OTHER_JOB_ID, '二つ目'),
    ]);
    const messages = [
      new FakeMessage({jobId: JOB_ID, to: 'taro@example.com'}),
      new FakeMessage({jobId: OTHER_JOB_ID, to: 'hanako@example.com'}),
    ];

    await handleBulkMailQueue(batchOf(messages), ENV);

    expect(log.mails.map(mail => [mail.to, mail.subject])).toEqual([
      ['taro@example.com', '一つ目'],
      ['hanako@example.com', '二つ目'],
    ]);
    // Each job's counters move on their own.
    expect(log.progress).toEqual([
      {p_job_id: JOB_ID, p_sent: 1, p_failed: 0},
      {p_job_id: OTHER_JOB_ID, p_sent: 1, p_failed: 0},
    ]);
  });

  it('retries a rate-limited message instead of acking it', async () => {
    const log = mockFetch([jobRow(JOB_ID)], {
      throttled: ['taro@example.com'],
    });
    const messages = [
      new FakeMessage({jobId: JOB_ID, to: 'taro@example.com'}),
      new FakeMessage({jobId: JOB_ID, to: 'hanako@example.com'}),
    ];

    await handleBulkMailQueue(batchOf(messages), ENV, NO_RETRIES);

    // The throttle says nothing about the address, so the recipient goes
    // back to the queue rather than being written off...
    expect(messages[0].acked).toBe(false);
    expect(messages[0].retried).toBe(true);
    // ...and is counted as neither sent nor failed until it settles, so
    // the job's own retry doesn't show up as a delivery to nobody.
    expect(log.progress).toEqual([{p_job_id: JOB_ID, p_sent: 1, p_failed: 0}]);
    // The rest of the batch is unaffected.
    expect(messages[1].acked).toBe(true);
    expect(log.mails.map(mail => mail.to)).toEqual([
      'taro@example.com',
      'hanako@example.com',
    ]);
  });

  it('acks a permanently rejected address and records the failure', async () => {
    const log = mockFetch([jobRow(JOB_ID)], {rejected: ['taro@example.com']});
    const messages = [new FakeMessage({jobId: JOB_ID, to: 'taro@example.com'})];

    await handleBulkMailQueue(batchOf(messages), ENV, NO_RETRIES);

    // Redelivering an address the provider refuses would only be refused
    // again, all the way to the dead letter queue.
    expect(messages[0].acked).toBe(true);
    expect(messages[0].retried).toBe(false);
    expect(log.progress).toEqual([{p_job_id: JOB_ID, p_sent: 0, p_failed: 1}]);
  });

  it('gives up on a throttled message on its last delivery', async () => {
    const log = mockFetch([jobRow(JOB_ID)], {
      throttled: ['taro@example.com'],
    });
    const messages = [
      new FakeMessage(
        {jobId: JOB_ID, to: 'taro@example.com'},
        MAIL_QUEUE_MAX_ATTEMPTS,
      ),
    ];

    await handleBulkMailQueue(batchOf(messages), ENV, NO_RETRIES);

    // A retry here would hand the message to the dead letter queue and
    // leave the job's counters short of `total` for good, so the recipient
    // is closed out as failed instead.
    expect(messages[0].acked).toBe(true);
    expect(messages[0].retried).toBe(false);
    expect(log.progress).toEqual([{p_job_id: JOB_ID, p_sent: 0, p_failed: 1}]);
  });

  it("records the job's progress so the staff screen can read it", async () => {
    const log = mockFetch([jobRow(JOB_ID)], {rejected: ['hanako@example.com']});
    const messages = [
      new FakeMessage({jobId: JOB_ID, to: 'taro@example.com'}),
      new FakeMessage({jobId: JOB_ID, to: 'hanako@example.com'}),
      new FakeMessage({jobId: JOB_ID, to: 'jiro@example.com'}),
    ];

    await handleBulkMailQueue(batchOf(messages), ENV, NO_RETRIES);

    // One call for the whole batch, and increments rather than totals --
    // consumer invocations run concurrently, so what this batch did is all
    // it can say.
    expect(log.progress).toEqual([{p_job_id: JOB_ID, p_sent: 2, p_failed: 1}]);
  });

  it('sends nothing for a job whose row is gone', async () => {
    const log = mockFetch([]);
    const messages = [new FakeMessage({jobId: JOB_ID, to: 'taro@example.com'})];

    await handleBulkMailQueue(batchOf(messages), ENV);

    // Nothing to send and no counter to move: redelivering would only meet
    // the same missing row.
    expect(log.mails).toEqual([]);
    expect(log.progress).toEqual([]);
    expect(messages[0].acked).toBe(true);
  });

  it('retries the batch when the job cannot be read', async () => {
    const log = mockFetch(
      Response.json({message: 'db is down'}, {status: 500}),
    );
    const messages = [new FakeMessage({jobId: JOB_ID, to: 'taro@example.com'})];

    await handleBulkMailQueue(batchOf(messages), ENV);

    // The lookup failing is this attempt's problem, not the recipient's,
    // so the message is kept rather than acked unsent.
    expect(log.mails).toEqual([]);
    expect(messages[0].acked).toBe(false);
    expect(messages[0].retried).toBe(true);
  });

  it('gives up on an unreadable job on its last delivery', async () => {
    const log = mockFetch(
      Response.json({message: 'db is down'}, {status: 500}),
    );
    const messages = [
      new FakeMessage(
        {jobId: JOB_ID, to: 'taro@example.com'},
        MAIL_QUEUE_MAX_ATTEMPTS,
      ),
    ];

    await handleBulkMailQueue(batchOf(messages), ENV);

    // Another retry would hand the message to the dead letter queue with
    // neither counter moved, and the job would sit at `sent + failed <
    // total` reading as a send that is still running.
    expect(messages[0].acked).toBe(true);
    expect(messages[0].retried).toBe(false);
    expect(log.progress).toEqual([{p_job_id: JOB_ID, p_sent: 0, p_failed: 1}]);
  });

  it('reports nothing for a batch it sent nothing from', async () => {
    const log = mockFetch([]);

    await handleBulkMailQueue(batchOf([]), ENV);

    expect(log.jobLookups).toEqual([]);
    expect(log.progress).toEqual([]);
  });
});
