import {afterEach, describe, expect, it} from 'bun:test';
import {verifyTurnstile} from './turnstile';

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

describe('verifyTurnstile', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns true only for success: true', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({success: true}),
      )) as unknown as typeof fetch;

    expect(await verifyTurnstile('secret', 'token')).toBe(true);
  });

  it('returns false when the body says the token was refused', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({
          success: false,
          'error-codes': ['invalid-input-response'],
        }),
      )) as unknown as typeof fetch;

    expect(await verifyTurnstile('secret', 'token')).toBe(false);
  });

  it('returns false on a non-2xx response', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response('nope', {status: 500}),
      )) as unknown as typeof fetch;

    expect(await verifyTurnstile('secret', 'token')).toBe(false);
  });

  it('returns false when the siteverify call fails', async () => {
    // Fail closed: a Cloudflare outage must not open the mail-bombing door
    // these two endpoints are behind.
    globalThis.fetch = (() =>
      Promise.reject(new Error('network down'))) as unknown as typeof fetch;

    expect(await verifyTurnstile('secret', 'token')).toBe(false);
  });

  it('returns false when the answer is not JSON', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response('<html>'))) as unknown as typeof fetch;

    expect(await verifyTurnstile('secret', 'token')).toBe(false);
  });

  it('posts the secret and the token to siteverify', async () => {
    const seen: Array<{url: string; body: unknown}> = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: typeof input === 'string' ? input : input.toString(),
        body: JSON.parse(String(init?.body)) as unknown,
      });
      return Promise.resolve(Response.json({success: true}));
    }) as unknown as typeof fetch;

    await verifyTurnstile('the-secret', 'the-token');

    expect(seen).toEqual([
      {
        url: SITEVERIFY_URL,
        // No `remoteip`: the address this Worker sees is the frontend's, not
        // the one the challenge was solved from. See `lib/turnstile.ts`.
        body: {secret: 'the-secret', response: 'the-token'},
      },
    ]);
  });
});
