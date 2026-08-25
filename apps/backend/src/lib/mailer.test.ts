import {afterEach, describe, expect, it} from 'bun:test';
import {MailSendError, ResendMailSender} from './mailer';

describe('ResendMailSender', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws on non-ok response', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, {status: 422}),
      )) as unknown as typeof fetch;

    const sender = new ResendMailSender('test-api-key', 'entry@example.com');

    await expect(
      sender.send({to: 'user@example.com', subject: 'Hi', html: '<p>Hi</p>'}),
    ).rejects.toThrow('Failed to send mail: 422');
  });

  it("reports a rate limit with the provider's `Retry-After`", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, {status: 429, headers: {'Retry-After': '3'}}),
      )) as unknown as typeof fetch;

    const sender = new ResendMailSender('test-api-key', 'entry@example.com');

    const error = await sender
      .send({to: 'user@example.com', subject: 'Hi', html: '<p>Hi</p>'})
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    expect(error).toBeInstanceOf(MailSendError);
    const mailError = error as MailSendError;
    expect(mailError.isRateLimited()).toBe(true);
    expect(mailError.retryAfterMs).toBe(3000);
  });

  it('leaves the retry delay unset when the provider names none', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, {status: 429}),
      )) as unknown as typeof fetch;

    const sender = new ResendMailSender('test-api-key', 'entry@example.com');

    const error = await sender
      .send({to: 'user@example.com', subject: 'Hi', html: '<p>Hi</p>'})
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    expect((error as MailSendError).retryAfterMs).toBeUndefined();
  });
});
