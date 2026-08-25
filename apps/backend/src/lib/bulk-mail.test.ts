import {describe, expect, it} from 'bun:test';
import {
  BACKGROUND_SEND_BUDGET_MS,
  MAIL_BATCH_INTERVAL_MS,
  MAIL_BATCH_SIZE,
  MAIL_RETRY_MAX_DELAY_MS,
  MAX_BACKGROUND_RECIPIENTS,
  sendBulkMail,
} from './bulk-mail';
import {MailSendError} from './mailer';
import type {MailSender, SendMailInput} from './mailer';

class RecordingMailSender implements MailSender {
  readonly sent: SendMailInput[] = [];
  inFlight = 0;
  maxInFlight = 0;

  constructor(private readonly rejectFor: readonly string[] = []) {}

  async send(input: SendMailInput): Promise<void> {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    // Yield so a whole batch is observably in flight at the same time.
    await Promise.resolve();
    this.inFlight--;
    if (this.rejectFor.includes(input.to)) {
      throw new Error('rejected');
    }
    this.sent.push(input);
  }
}

/**
 * Rejects the first `throttleCount` sends with a rate-limit error, the way
 * the provider does when another mail job is eating the shared quota, then
 * accepts everything after that.
 */
class ThrottlingMailSender implements MailSender {
  readonly sent: SendMailInput[] = [];
  attempts = 0;
  readonly waitedAt: number[] = [];

  constructor(
    private readonly throttleCount: number,
    private readonly retryAfterMs?: number,
  ) {}

  async send(input: SendMailInput): Promise<void> {
    this.attempts++;
    this.waitedAt.push(Date.now());
    if (this.attempts <= this.throttleCount) {
      throw new MailSendError(429, this.retryAfterMs);
    }
    this.sent.push(input);
  }
}

const CONTENT = {subject: 'お知らせ', html: '<p>本文</p>'};

describe('sendBulkMail', () => {
  it('sends one message per recipient', async () => {
    const mailer = new RecordingMailSender();

    const result = await sendBulkMail(
      mailer,
      ['a@example.com', 'b@example.com'],
      CONTENT,
    );

    expect(result).toEqual({sent: 2, failed: []});
    expect(mailer.sent).toEqual([
      {to: 'a@example.com', ...CONTENT},
      {to: 'b@example.com', ...CONTENT},
    ]);
  });

  it('keeps at most `batchSize` sends in flight and spaces the batches', async () => {
    const mailer = new RecordingMailSender();
    const recipients = [
      'a@example.com',
      'b@example.com',
      'c@example.com',
      'd@example.com',
      'e@example.com',
    ];
    const startedAt = Date.now();

    const result = await sendBulkMail(mailer, recipients, CONTENT, {
      batchSize: 2,
      intervalMs: 20,
    });

    expect(result.sent).toBe(5);
    expect(mailer.maxInFlight).toBe(2);
    // Three batches means two waits between them.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(40);
  });

  it('reports rejected recipients without stopping the run', async () => {
    const mailer = new RecordingMailSender(['b@example.com']);

    const result = await sendBulkMail(
      mailer,
      ['a@example.com', 'b@example.com', 'c@example.com'],
      CONTENT,
    );

    expect(result).toEqual({sent: 2, failed: ['b@example.com']});
    expect(mailer.sent.map(input => input.to)).toEqual([
      'a@example.com',
      'c@example.com',
    ]);
  });

  it('rejects a batch size that would never advance the loop', async () => {
    const mailer = new RecordingMailSender();

    for (const batchSize of [0, -1, 1.5, Number.NaN]) {
      await expect(
        sendBulkMail(mailer, ['a@example.com'], CONTENT, {batchSize}),
      ).rejects.toThrow(RangeError);
    }
    expect(mailer.sent).toEqual([]);
  });

  it('retries a rate-limited send instead of failing the recipient', async () => {
    const mailer = new ThrottlingMailSender(2);

    const result = await sendBulkMail(mailer, ['a@example.com'], CONTENT, {
      retryBaseDelayMs: 5,
    });

    expect(result).toEqual({sent: 1, failed: []});
    expect(mailer.attempts).toBe(3);
    expect(mailer.sent).toEqual([{to: 'a@example.com', ...CONTENT}]);
  });

  it("waits as long as the provider's `Retry-After` asks", async () => {
    const mailer = new ThrottlingMailSender(1, 40);

    const result = await sendBulkMail(mailer, ['a@example.com'], CONTENT, {
      // Far shorter than the provider's answer, so a wait of at least 40ms
      // can only come from honouring `Retry-After`.
      retryBaseDelayMs: 1,
    });

    expect(result).toEqual({sent: 1, failed: []});
    expect(mailer.waitedAt[1] - mailer.waitedAt[0]).toBeGreaterThanOrEqual(40);
  });

  it('gives up on a recipient once the retries are exhausted', async () => {
    const mailer = new ThrottlingMailSender(Number.POSITIVE_INFINITY);

    const result = await sendBulkMail(mailer, ['a@example.com'], CONTENT, {
      maxRetries: 2,
      retryBaseDelayMs: 1,
    });

    expect(result).toEqual({sent: 0, failed: ['a@example.com']});
    // The first attempt plus the two retries, and no more.
    expect(mailer.attempts).toBe(3);
  });

  it('does not retry a rejection that is not a rate limit', async () => {
    const mailer = new ThrottlingMailSender(0);
    const permanent: MailSender = {
      send: async () => {
        mailer.attempts++;
        throw new MailSendError(422);
      },
    };

    const result = await sendBulkMail(permanent, ['a@example.com'], CONTENT, {
      retryBaseDelayMs: 1,
    });

    expect(result).toEqual({sent: 0, failed: ['a@example.com']});
    expect(mailer.attempts).toBe(1);
  });

  it('rejects a retry budget that is not a whole number of retries', async () => {
    const mailer = new RecordingMailSender();

    for (const maxRetries of [-1, 1.5, Number.NaN]) {
      await expect(
        sendBulkMail(mailer, ['a@example.com'], CONTENT, {maxRetries}),
      ).rejects.toThrow(RangeError);
    }
    expect(mailer.sent).toEqual([]);
  });

  it('rejects a budget that leaves no time to send in', async () => {
    const mailer = new RecordingMailSender();

    for (const budgetMs of [0, -1, Number.NaN]) {
      await expect(
        sendBulkMail(mailer, ['a@example.com'], CONTENT, {budgetMs}),
      ).rejects.toThrow(RangeError);
    }
    expect(mailer.sent).toEqual([]);
  });

  it('stops at its budget and reports the recipients it never reached', async () => {
    const mailer = new RecordingMailSender();
    const recipients = [
      'a@example.com',
      'b@example.com',
      'c@example.com',
      'd@example.com',
    ];

    const result = await sendBulkMail(mailer, recipients, CONTENT, {
      batchSize: 2,
      intervalMs: 50,
      // Room for the first batch only: the wait before the second one
      // already runs past the deadline.
      budgetMs: 20,
    });

    // Left in `failed` rather than dropped, so the caller can log that
    // these two were never tried instead of the platform cancelling the
    // run mid-flight with nothing reported.
    expect(result).toEqual({
      sent: 2,
      failed: ['c@example.com', 'd@example.com'],
    });
    expect(mailer.sent.map(input => input.to)).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  it('gives up on a retry that would outlast the run', async () => {
    const mailer = new ThrottlingMailSender(1, MAIL_RETRY_MAX_DELAY_MS);

    const result = await sendBulkMail(mailer, ['a@example.com'], CONTENT, {
      budgetMs: 50,
    });

    // Waiting out the throttle would have the platform cancel the run
    // mid-wait, so the send is abandoned after its first attempt instead.
    expect(result).toEqual({sent: 0, failed: ['a@example.com']});
    expect(mailer.attempts).toBe(1);
  });

  it('sends nothing for an empty recipient list', async () => {
    const mailer = new RecordingMailSender();

    const result = await sendBulkMail(mailer, [], CONTENT);

    expect(result).toEqual({sent: 0, failed: []});
    expect(mailer.sent).toEqual([]);
  });
});

describe('MAX_BACKGROUND_RECIPIENTS', () => {
  it('paces a full list well inside the post-response budget', () => {
    const batches = Math.ceil(MAX_BACKGROUND_RECIPIENTS / MAIL_BATCH_SIZE);
    const pacingMs = (batches - 1) * MAIL_BATCH_INTERVAL_MS;

    // The waits alone must leave room for the sends themselves, so half the
    // budget is the most the pacing may claim. A change to the batch size or
    // interval that breaks this makes the ceiling unreachable in practice.
    expect(pacingMs).toBeLessThanOrEqual(BACKGROUND_SEND_BUDGET_MS / 2);
  });

  it('leaves one retry wait unable to swallow the budget', () => {
    // A single throttled message waits inside the run, so a cap anywhere
    // near the whole budget would cost every recipient queued behind it
    // their send.
    expect(MAIL_RETRY_MAX_DELAY_MS).toBeLessThanOrEqual(
      BACKGROUND_SEND_BUDGET_MS / 4,
    );
  });
});
