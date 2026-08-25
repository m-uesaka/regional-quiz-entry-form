import {describe, expect, it} from 'bun:test';
import {sendBulkMail} from './bulk-mail';
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

  it('sends nothing for an empty recipient list', async () => {
    const mailer = new RecordingMailSender();

    const result = await sendBulkMail(mailer, [], CONTENT);

    expect(result).toEqual({sent: 0, failed: []});
    expect(mailer.sent).toEqual([]);
  });
});
