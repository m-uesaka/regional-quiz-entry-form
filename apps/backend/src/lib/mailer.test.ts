import {afterEach, describe, expect, it} from 'bun:test';
import {ResendMailSender} from './mailer';

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
});
