import {afterEach, describe, expect, it, spyOn} from 'bun:test';
import {MAIL_SENDER_DOMAIN} from '@regional-quiz/shared';
import {testBindings} from '../test-support/bindings';
import {
  MailConfigError,
  MailSendError,
  ResendMailSender,
  createMailSender,
} from './mailer';

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

  it('reports a provider fault as transient', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(null, {status: 503}),
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
    expect(mailError.status).toBe(503);
    expect(mailError.isTransient()).toBe(true);
    // Not a throttle, so `sendPacedMail()` leaves it to the caller.
    expect(mailError.isRateLimited()).toBe(false);
  });

  it('sends the idempotency key as a header and leaves it out of the mail', async () => {
    let request: {headers: Headers; body: Record<string, unknown>} | null =
      null;
    globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
      request = {
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      };
      return Promise.resolve(Response.json({id: 'mail-id'}));
    }) as unknown as typeof fetch;

    const sender = new ResendMailSender('test-api-key', 'entry@example.com');
    await sender.send({
      to: 'user@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      idempotencyKey: 'bulk-mail/message-1',
    });

    expect(request!.headers.get('Idempotency-Key')).toBe('bulk-mail/message-1');
    expect(request!.body).toEqual({
      from: 'entry@example.com',
      to: 'user@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
    });
  });

  it('sends no idempotency key for a mail that names none', async () => {
    let headers: Headers | null = null;
    globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      return Promise.resolve(Response.json({id: 'mail-id'}));
    }) as unknown as typeof fetch;

    const sender = new ResendMailSender('test-api-key', 'entry@example.com');
    await sender.send({
      to: 'user@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
    });

    expect(headers!.has('Idempotency-Key')).toBe(false);
  });

  it("reads the provider's name for a refusal off its body", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json(
          {
            statusCode: 409,
            name: 'concurrent_idempotent_requests',
            message: 'There is another request in progress.',
          },
          {status: 409},
        ),
      )) as unknown as typeof fetch;

    const sender = new ResendMailSender('test-api-key', 'entry@example.com');
    const error = await sender
      .send({to: 'user@example.com', subject: 'Hi', html: '<p>Hi</p>'})
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    expect((error as MailSendError).code).toBe(
      'concurrent_idempotent_requests',
    );
    expect((error as MailSendError).isTransient()).toBe(true);
  });

  it('wraps a network error so the caller can tell it is transient', async () => {
    const networkError = new TypeError('Network connection lost.');
    globalThis.fetch = (() =>
      Promise.reject(networkError)) as unknown as typeof fetch;

    const sender = new ResendMailSender('test-api-key', 'entry@example.com');

    const error = await sender
      .send({to: 'user@example.com', subject: 'Hi', html: '<p>Hi</p>'})
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    expect(error).toBeInstanceOf(MailSendError);
    const mailError = error as MailSendError;
    expect(mailError.status).toBeUndefined();
    expect(mailError.cause).toBe(networkError);
    expect(mailError.isTransient()).toBe(true);
  });

  // #345: a stalled connection must not hold the caller until the platform
  // kills it.
  it('gives up on an answer that does not come in time, as transient', async () => {
    let signal: AbortSignal | undefined;
    globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      // Never answers; only the abort settles it, as `fetch` does.
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason));
      });
    }) as unknown as typeof fetch;

    const sender = new ResendMailSender(
      'test-api-key',
      'entry@example.com',
      undefined,
      10,
    );

    const error = await sender
      .send({to: 'user@example.com', subject: 'Hi', html: '<p>Hi</p>'})
      .then(
        () => null,
        (thrown: unknown) => thrown,
      );

    expect(signal?.aborted).toBe(true);
    expect(error).toBeInstanceOf(MailSendError);
    const mailError = error as MailSendError;
    expect(mailError.status).toBeUndefined();
    expect((mailError.cause as Error).name).toBe('TimeoutError');
    expect(mailError.isTransient()).toBe(true);
  });

  it('sends with a timeout by default', async () => {
    let signal: AbortSignal | null | undefined;
    globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
      signal = init?.signal;
      return Promise.resolve(new Response(null, {status: 200}));
    }) as unknown as typeof fetch;

    await new ResendMailSender('test-api-key', 'entry@example.com').send({
      to: 'user@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
    });

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  // #344: `fetch` would refuse these as it does a lost connection, and the
  // caller would retry a send that can never succeed.
  it('refuses an API origin it cannot post to before anything is sent', () => {
    for (const baseUrl of [
      'localhost:8787',
      '127.0.0.1:8787',
      'not a url',
      'ftp://mail.example.com',
    ]) {
      expect(
        () => new ResendMailSender('test-api-key', 'e@example.com', baseUrl),
      ).toThrow(MailConfigError);
    }
  });
});

describe('MailSendError.isTransient', () => {
  it('holds for a throttle, a timeout, a provider fault, or no answer at all', () => {
    for (const status of [undefined, 408, 429, 500, 502, 503, 504]) {
      expect(new MailSendError(status).isTransient()).toBe(true);
    }
  });

  // Resend says to ask again later; the send under the key may yet fail.
  it('holds for a send whose key another send is still using', () => {
    expect(
      new MailSendError(409, undefined, {
        code: 'concurrent_idempotent_requests',
      }).isTransient(),
    ).toBe(true);
  });

  // A changed body under a used key is refused however often it is sent.
  it('does not hold for a key reused with another body', () => {
    expect(
      new MailSendError(409, undefined, {
        code: 'invalid_idempotent_request',
      }).isTransient(),
    ).toBe(false);
  });

  it('does not hold for a rejection of the message itself', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(new MailSendError(status).isTransient()).toBe(false);
    }
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

    const mailer = createMailSender(
      testBindings({MAIL_API_BASE_URL: mailApiBaseUrl}),
    );
    await mailer.send({
      to: 'user@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
    });
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

  // #344: checked when the sender is made, but handed to each send, so a
  // caller that makes the sender outside its `try` still sees a failed send
  // -- a permanent one -- rather than an exception of its own.
  it('fails every send, permanently, when the bound base URL is invalid', async () => {
    let fetched = false;
    globalThis.fetch = (() => {
      fetched = true;
      return Promise.resolve(new Response(null, {status: 200}));
    }) as unknown as typeof fetch;
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});

    try {
      const mailer = createMailSender(
        testBindings({MAIL_API_BASE_URL: 'localhost:8787'}),
      );
      const error = await mailer
        .send({to: 'user@example.com', subject: 'Hi', html: '<p>Hi</p>'})
        .then(
          () => null,
          (thrown: unknown) => thrown,
        );

      expect(error).toBeInstanceOf(MailConfigError);
      // Not a `MailSendError`, so no caller takes it for a network error.
      expect(error).not.toBeInstanceOf(MailSendError);
      expect(fetched).toBe(false);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('sends from the bound address under the site’s display name', async () => {
    let body: {from?: string} = {};
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return Promise.resolve(new Response(null, {status: 200}));
    }) as unknown as typeof fetch;

    await createMailSender(testBindings()).send({
      to: 'user@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
    });

    expect(body.from).toBe(
      '地域クイズ最強位・新人王 エントリー <entry@example.com>',
    );
  });
});

// The entry form tells participants whose carrier filters by sender domain
// to allow `MAIL_SENDER_DOMAIN`, so every environment's sending address has
// to sit under it.
describe('MAIL_FROM_ADDRESS in wrangler.toml', () => {
  it('sends mail in every environment from under the domain the entry form names', async () => {
    const config = await Bun.file(
      `${import.meta.dir}/../../wrangler.toml`,
    ).text();
    const addresses = [
      ...config.matchAll(/^MAIL_FROM_ADDRESS = "([^"]+)"/gm),
    ].map(match => match[1]);

    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) {
      const domain = address.split('@')[1];
      expect(
        domain === MAIL_SENDER_DOMAIN ||
          domain.endsWith(`.${MAIL_SENDER_DOMAIN}`),
      ).toBe(true);
    }
  });
});
