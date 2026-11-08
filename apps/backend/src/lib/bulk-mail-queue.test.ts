import {afterEach, describe, expect, it} from 'bun:test';
import {testBindings} from '../test-support/bindings';
import {MAIL_FROM_NAME} from './mailer';
import {
  MAIL_QUEUE_MAX_ATTEMPTS,
  MAIL_QUEUE_RETRY_DELAY_SECONDS,
  handleBulkMailQueue,
  type BulkMailMessage,
} from './bulk-mail-queue';

const ENV = testBindings();

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
    this.id = `message-${'to' in body ? body.to : body.entryId}`;
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
  /** The `email_verification_tokens` rows inserted. */
  tokenInserts: Array<Record<string, unknown>>;
  /** The `email_verification_tokens` delete URLs. */
  tokenDeletes: string[];
}

const ENTRY_ID = '77777777-7777-7777-7777-777777777777';
const TOKEN_ID = '88888888-8888-8888-8888-888888888888';

/** An `entries` row as `prepareVerificationResend()` selects it. */
function pendingEntryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    status: 'pending_verification',
    participants: {email: 'hanako@example.com'},
    tournaments: {
      name: 'テスト大会',
      type: 'saikyoi',
      capacity: null,
      regions: {name: '東京'},
    },
    // Its only link expired, which is what makes it due a fresh one.
    email_verification_tokens: [
      {expires_at: '2026-01-01T00:00:00Z', used_at: null},
    ],
    ...overrides,
  };
}

/**
 * Mocks both `fetch` targets the consumer talks to: Supabase, which
 * answers the `mail_jobs` lookups from `jobRows` and records the progress
 * calls, and the Resend API, whose sends are recorded and answered with a
 * success unless the address is listed in `rejected` (a permanent refusal),
 * `throttled` (a 429), `unavailable` (a 503) or `unreachable` (the request
 * gets no answer and `fetch` rejects).
 * @param jobRows The rows the content lookup finds, or a ready-made
 *     `Response` to simulate a failing query.
 */
function mockFetch(
  jobRows: Array<ReturnType<typeof jobRow>> | Response,
  {
    rejected = [],
    throttled = [],
    unavailable = [],
    unreachable = [],
    entries = [],
  }: {
    rejected?: readonly string[];
    throttled?: readonly string[];
    unavailable?: readonly string[];
    unreachable?: readonly string[];
    /** The `entries` rows a verification resend reads, or a failure. */
    entries?: unknown[] | Response;
  } = {},
): FetchLog {
  const log: FetchLog = {
    mails: [],
    progress: [],
    jobLookups: [],
    tokenInserts: [],
    tokenDeletes: [],
  };

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
      if (unavailable.includes(mail.to)) {
        return Promise.resolve(new Response(null, {status: 503}));
      }
      if (unreachable.includes(mail.to)) {
        return Promise.reject(new TypeError('Network connection lost.'));
      }
      return Promise.resolve(Response.json({id: 'mail-id'}));
    }

    if (url.includes('/rpc/record_mail_job_progress')) {
      log.progress.push(JSON.parse(String(init?.body)) as ProgressCall);
      return Promise.resolve(Response.json(null));
    }

    if (url.includes('/rest/v1/entries')) {
      return Promise.resolve(
        entries instanceof Response ? entries.clone() : Response.json(entries),
      );
    }
    if (url.includes('/rest/v1/email_verification_tokens')) {
      if (init?.method === 'DELETE') {
        log.tokenDeletes.push(url);
        return Promise.resolve(new Response(null, {status: 204}));
      }
      log.tokenInserts.push(
        JSON.parse(String(init?.body)) as Record<string, unknown>,
      );
      return Promise.resolve(Response.json({id: TOKEN_ID}));
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
        from: `${MAIL_FROM_NAME} <${ENV.MAIL_FROM_ADDRESS}>`,
        to: 'taro@example.com',
        subject: '大会のご案内',
        html: '<p>大会のご案内</p>',
      },
      {
        from: `${MAIL_FROM_NAME} <${ENV.MAIL_FROM_ADDRESS}>`,
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

  it('retries a message the provider failed on with a 5xx', async () => {
    const log = mockFetch([jobRow(JOB_ID)], {
      unavailable: ['taro@example.com'],
    });
    const messages = [
      new FakeMessage({jobId: JOB_ID, to: 'taro@example.com'}),
      new FakeMessage({jobId: JOB_ID, to: 'hanako@example.com'}),
    ];

    await handleBulkMailQueue(batchOf(messages), ENV, NO_RETRIES);

    // A fault on the provider's side says nothing about the address.
    expect(messages[0].acked).toBe(false);
    expect(messages[0].retriedWith).toEqual({
      delaySeconds: MAIL_QUEUE_RETRY_DELAY_SECONDS,
    });
    // The delivered recipient is acked on its own, so the redelivery
    // carries only the one that failed, and nothing is counted as failed
    // yet.
    expect(messages[1].acked).toBe(true);
    expect(messages[1].retried).toBe(false);
    expect(log.progress).toEqual([{p_job_id: JOB_ID, p_sent: 1, p_failed: 0}]);
  });

  it('retries a message whose send got no answer', async () => {
    const log = mockFetch([jobRow(JOB_ID)], {
      unreachable: ['taro@example.com'],
    });
    const messages = [new FakeMessage({jobId: JOB_ID, to: 'taro@example.com'})];

    await handleBulkMailQueue(batchOf(messages), ENV, NO_RETRIES);

    expect(messages[0].acked).toBe(false);
    expect(messages[0].retried).toBe(true);
    expect(log.progress).toEqual([]);
  });

  it('counts a recipient once when its redelivery goes through', async () => {
    const first = mockFetch([jobRow(JOB_ID)], {
      unavailable: ['taro@example.com'],
    });
    const failed = new FakeMessage({jobId: JOB_ID, to: 'taro@example.com'});
    const delivered = new FakeMessage({
      jobId: JOB_ID,
      to: 'hanako@example.com',
    });

    await handleBulkMailQueue(batchOf([failed, delivered]), ENV, NO_RETRIES);
    expect(failed.retried).toBe(true);

    // The platform redelivers only the message that was sent back.
    const second = mockFetch([jobRow(JOB_ID)]);
    const redelivered = new FakeMessage(failed.body, failed.attempts + 1);
    await handleBulkMailQueue(batchOf([redelivered]), ENV, NO_RETRIES);

    expect(redelivered.acked).toBe(true);
    // Hanako is not mailed again, and the two batches add up to the job's
    // two recipients with no failure left over from the first attempt.
    expect(second.mails.map(mail => mail.to)).toEqual(['taro@example.com']);
    expect([...first.progress, ...second.progress]).toEqual([
      {p_job_id: JOB_ID, p_sent: 1, p_failed: 0},
      {p_job_id: JOB_ID, p_sent: 1, p_failed: 0},
    ]);
  });

  it('gives up on a 5xx or a network error on its last delivery', async () => {
    const log = mockFetch([jobRow(JOB_ID)], {
      unavailable: ['taro@example.com'],
      unreachable: ['hanako@example.com'],
    });
    const messages = [
      new FakeMessage(
        {jobId: JOB_ID, to: 'taro@example.com'},
        MAIL_QUEUE_MAX_ATTEMPTS,
      ),
      new FakeMessage(
        {jobId: JOB_ID, to: 'hanako@example.com'},
        MAIL_QUEUE_MAX_ATTEMPTS,
      ),
    ];

    await handleBulkMailQueue(batchOf(messages), ENV, NO_RETRIES);

    // As with a throttle: a retry now would only dead-letter them and
    // leave the job short of its total.
    expect(messages.map(message => message.acked)).toEqual([true, true]);
    expect(messages.map(message => message.retried)).toEqual([false, false]);
    expect(log.progress).toEqual([{p_job_id: JOB_ID, p_sent: 0, p_failed: 2}]);
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
  describe('a verification resend', () => {
    const resendJob = () => ({
      ...jobRow(JOB_ID, '【地域クイズ最強位・新人王】確認'),
      body_html: '',
    });

    it('sends the entry a fresh confirmation link', async () => {
      const log = mockFetch([resendJob()], {entries: [pendingEntryRow()]});
      const messages = [new FakeMessage({jobId: JOB_ID, entryId: ENTRY_ID})];

      await handleBulkMailQueue(batchOf(messages), ENV);

      // The token is issued here, not carried in the message.
      expect(log.tokenInserts).toHaveLength(1);
      expect(log.tokenInserts[0].entry_id).toBe(ENTRY_ID);
      expect(log.mails).toHaveLength(1);
      expect(log.mails[0].to).toBe('hanako@example.com');
      expect(log.mails[0].subject).toContain(
        '「テスト大会」のエントリーを確定してください',
      );
      expect(log.mails[0].html).toContain(`${ENV.FRONTEND_URL}/verify?token=`);
      expect(messages[0].acked).toBe(true);
      expect(log.tokenDeletes).toEqual([]);
      expect(log.progress).toEqual([
        {p_job_id: JOB_ID, p_sent: 1, p_failed: 0},
      ]);
    });

    it('sends nothing to an entry confirmed since the reminder was asked for', async () => {
      const log = mockFetch([resendJob()], {
        entries: [pendingEntryRow({status: 'confirmed'})],
      });
      const messages = [new FakeMessage({jobId: JOB_ID, entryId: ENTRY_ID})];

      await handleBulkMailQueue(batchOf(messages), ENV);

      expect(log.tokenInserts).toEqual([]);
      expect(log.mails).toEqual([]);
      expect(messages[0].acked).toBe(true);
      // Counted as not sent, so the job still adds up to its total.
      expect(log.progress).toEqual([
        {p_job_id: JOB_ID, p_sent: 0, p_failed: 1},
      ]);
    });

    it('sends nothing to an entry that has a live link again', async () => {
      // A second press of the button, handled after the first one's mail.
      const log = mockFetch([resendJob()], {
        entries: [
          pendingEntryRow({
            email_verification_tokens: [
              {expires_at: '2999-01-01T00:00:00Z', used_at: null},
            ],
          }),
        ],
      });
      const messages = [new FakeMessage({jobId: JOB_ID, entryId: ENTRY_ID})];

      await handleBulkMailQueue(batchOf(messages), ENV);

      expect(log.mails).toEqual([]);
      expect(messages[0].acked).toBe(true);
    });

    it('discards the link of a throttled reminder before retrying it', async () => {
      const log = mockFetch([resendJob()], {
        entries: [pendingEntryRow()],
        throttled: ['hanako@example.com'],
      });
      const messages = [new FakeMessage({jobId: JOB_ID, entryId: ENTRY_ID})];

      await handleBulkMailQueue(batchOf(messages), ENV, NO_RETRIES);

      // Left in place, the undelivered link would read as live on the
      // redelivery, and the entry would be passed over unsent.
      expect(log.tokenDeletes).toHaveLength(1);
      expect(log.tokenDeletes[0]).toContain(`id=eq.${TOKEN_ID}`);
      expect(messages[0].retried).toBe(true);
    });

    it('discards the link of a reminder the provider failed on and retries it', async () => {
      const log = mockFetch([resendJob()], {
        entries: [pendingEntryRow()],
        unavailable: ['hanako@example.com'],
      });
      const messages = [new FakeMessage({jobId: JOB_ID, entryId: ENTRY_ID})];

      await handleBulkMailQueue(batchOf(messages), ENV, NO_RETRIES);

      // Not written off: the redelivery issues a fresh link and sends it.
      expect(log.tokenDeletes).toHaveLength(1);
      expect(messages[0].acked).toBe(false);
      expect(messages[0].retried).toBe(true);
      expect(log.progress).toEqual([]);
    });

    it('retries a reminder whose entry cannot be read', async () => {
      const log = mockFetch([resendJob()], {
        entries: Response.json({message: 'db is down'}, {status: 500}),
      });
      const messages = [new FakeMessage({jobId: JOB_ID, entryId: ENTRY_ID})];

      await handleBulkMailQueue(batchOf(messages), ENV);

      expect(log.mails).toEqual([]);
      expect(messages[0].acked).toBe(false);
      expect(messages[0].retried).toBe(true);
    });
  });
});
