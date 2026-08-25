import {describe, expect, it} from 'bun:test';
import {sendBulkMail} from './bulk-mail';
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

  it('sends nothing for an empty recipient list', async () => {
    const mailer = new RecordingMailSender();

    const result = await sendBulkMail(mailer, [], CONTENT);

    expect(result).toEqual({sent: 0, failed: []});
    expect(mailer.sent).toEqual([]);
  });
});
