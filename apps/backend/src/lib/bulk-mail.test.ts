import {describe, expect, it} from 'bun:test';
import {sendPacedMail} from './bulk-mail';
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

/** The same announcement addressed to each of `recipients`. */
function messagesTo(...recipients: string[]): SendMailInput[] {
  return recipients.map(to => ({to, ...CONTENT}));
}

const DELIVERED = {ok: true} as const;

describe('sendPacedMail', () => {
  it('sends one message per recipient', async () => {
    const mailer = new RecordingMailSender();

    const outcomes = await sendPacedMail(
      mailer,
      messagesTo('a@example.com', 'b@example.com'),
    );

    expect(outcomes).toEqual([DELIVERED, DELIVERED]);
    expect(mailer.sent).toEqual([
      {to: 'a@example.com', ...CONTENT},
      {to: 'b@example.com', ...CONTENT},
    ]);
  });

  it('sends each message its own content', async () => {
    const mailer = new RecordingMailSender();

    // What a queue batch looks like when two staff members send at once:
    // one call, two different announcements.
    const outcomes = await sendPacedMail(mailer, [
      {to: 'a@example.com', subject: '一つ目', html: '<p>1</p>'},
      {to: 'b@example.com', subject: '二つ目', html: '<p>2</p>'},
    ]);

    expect(outcomes).toEqual([DELIVERED, DELIVERED]);
    expect(mailer.sent.map(input => input.subject)).toEqual([
      '一つ目',
      '二つ目',
    ]);
  });

  it('keeps at most `batchSize` sends in flight and spaces the batches', async () => {
    const mailer = new RecordingMailSender();
    const messages = messagesTo(
      'a@example.com',
      'b@example.com',
      'c@example.com',
      'd@example.com',
      'e@example.com',
    );
    const startedAt = Date.now();

    const outcomes = await sendPacedMail(mailer, messages, {
      batchSize: 2,
      intervalMs: 20,
    });

    expect(outcomes.filter(outcome => outcome.ok)).toHaveLength(5);
    expect(mailer.maxInFlight).toBe(2);
    // Three batches means two waits between them.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(40);
  });

  it('reports a rejected message without stopping the run', async () => {
    const mailer = new RecordingMailSender(['b@example.com']);

    const outcomes = await sendPacedMail(
      mailer,
      messagesTo('a@example.com', 'b@example.com', 'c@example.com'),
    );

    // Positional, so the caller can tell which recipient each outcome
    // belongs to without the addresses being repeated back.
    expect(outcomes.map(outcome => outcome.ok)).toEqual([true, false, true]);
    expect(mailer.sent.map(input => input.to)).toEqual([
      'a@example.com',
      'c@example.com',
    ]);
  });

  it('rejects a batch size that would never advance the loop', async () => {
    const mailer = new RecordingMailSender();

    for (const batchSize of [0, -1, 1.5, Number.NaN]) {
      await expect(
        sendPacedMail(mailer, messagesTo('a@example.com'), {batchSize}),
      ).rejects.toThrow(RangeError);
    }
    expect(mailer.sent).toEqual([]);
  });

  it('retries a rate-limited send instead of failing the recipient', async () => {
    const mailer = new ThrottlingMailSender(2);

    const outcomes = await sendPacedMail(mailer, messagesTo('a@example.com'), {
      retryBaseDelayMs: 5,
    });

    expect(outcomes).toEqual([DELIVERED]);
    expect(mailer.attempts).toBe(3);
    expect(mailer.sent).toEqual([{to: 'a@example.com', ...CONTENT}]);
  });

  it("waits as long as the provider's `Retry-After` asks", async () => {
    const mailer = new ThrottlingMailSender(1, 40);

    const outcomes = await sendPacedMail(mailer, messagesTo('a@example.com'), {
      // Far shorter than the provider's answer, so a wait of at least 40ms
      // can only come from honouring `Retry-After`.
      retryBaseDelayMs: 1,
    });

    expect(outcomes).toEqual([DELIVERED]);
    expect(mailer.waitedAt[1] - mailer.waitedAt[0]).toBeGreaterThanOrEqual(40);
  });

  it('hands back the throttle once the retries are exhausted', async () => {
    const mailer = new ThrottlingMailSender(Number.POSITIVE_INFINITY);

    const [outcome] = await sendPacedMail(mailer, messagesTo('a@example.com'), {
      maxRetries: 2,
      retryBaseDelayMs: 1,
    });

    // The rejection travels with the outcome rather than being flattened
    // to "failed": the queue consumer reads it to decide that this
    // recipient is worth another delivery, unlike a rejected address.
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toBeInstanceOf(MailSendError);
    // The first attempt plus the two retries, and no more.
    expect(mailer.attempts).toBe(3);
  });

  it('does not retry a rejection that is not a rate limit', async () => {
    let attempts = 0;
    const permanent: MailSender = {
      send: () => {
        attempts++;
        return Promise.reject(new MailSendError(422));
      },
    };

    const outcomes = await sendPacedMail(
      permanent,
      messagesTo('a@example.com'),
      {retryBaseDelayMs: 1},
    );

    expect(outcomes.map(outcome => outcome.ok)).toEqual([false]);
    expect(attempts).toBe(1);
  });

  it('rejects a retry budget that is not a whole number of retries', async () => {
    const mailer = new RecordingMailSender();

    for (const maxRetries of [-1, 1.5, Number.NaN]) {
      await expect(
        sendPacedMail(mailer, messagesTo('a@example.com'), {maxRetries}),
      ).rejects.toThrow(RangeError);
    }
    expect(mailer.sent).toEqual([]);
  });

  it('sends nothing for an empty message list', async () => {
    const mailer = new RecordingMailSender();

    const outcomes = await sendPacedMail(mailer, []);

    expect(outcomes).toEqual([]);
    expect(mailer.sent).toEqual([]);
  });
});
