import {afterEach, describe, expect, it} from 'bun:test';
import type {Bindings} from '../types/env';
import {MailSendError, ResendMailSender, createMailSender} from './mailer';

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

describe('createMailSender', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /**
   * Sends one mail through `createMailSender()` and reports the URL the
   * send was posted to.
   * @param mailApiBaseUrl The `MAIL_API_BASE_URL` binding under test.
   */
  async function postedUrlFor(mailApiBaseUrl?: string): Promise<string> {
    let posted = '';
    globalThis.fetch = ((input: RequestInfo | URL) => {
      posted = String(input);
      return Promise.resolve(new Response(null, {status: 200}));
    }) as unknown as typeof fetch;

    const mailer = createMailSender({
      MAIL_API_KEY: 'test-api-key',
      MAIL_FROM_ADDRESS: 'entry@example.com',
      MAIL_API_BASE_URL: mailApiBaseUrl,
    } as Bindings);
    await mailer.send({to: 'user@example.com', subject: 'Hi', html: '<p>Hi</p>'});
    return posted;
  }

  it('posts to Resend when no base URL is bound', async () => {
    expect(await postedUrlFor()).toBe('https://api.resend.com/emails');
  });

  it('posts to Resend when the bound base URL is blank', async () => {
    expect(await postedUrlFor('   ')).toBe('https://api.resend.com/emails');
  });

  it('posts to the bound base URL', async () => {
    expect(await postedUrlFor('http://127.0.0.1:8788')).toBe(
      'http://127.0.0.1:8788/emails',
    );
  });

  it('does not double the slash on a base URL that ends in one', async () => {
    expect(await postedUrlFor('http://127.0.0.1:8788/')).toBe(
      'http://127.0.0.1:8788/emails',
    );
  });
});
