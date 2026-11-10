import {afterEach, describe, expect, it} from 'bun:test';
import {verifyTurnstile, type TurnstileExpectation} from './turnstile';

const EXPECTED: TurnstileExpectation = {
  hostnames: new Set(['entry.example.com']),
  action: 'entry',
};

/** Answers siteverify with `body`. */
function siteverifyAnswers(body: unknown): void {
  globalThis.fetch = (() =>
    Promise.resolve(Response.json(body))) as unknown as typeof fetch;
}

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
        Response.json({success: true, hostname: 'entry.example.com'}),
      )) as unknown as typeof fetch;

    expect(await verifyTurnstile('secret', 'token', EXPECTED)).toBe(true);
  });

  it('returns false when the body says the token was refused', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({
          success: false,
          'error-codes': ['invalid-input-response'],
        }),
      )) as unknown as typeof fetch;

    expect(await verifyTurnstile('secret', 'token', EXPECTED)).toBe(false);
  });

  it('returns false on a non-2xx response', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response('nope', {status: 500}),
      )) as unknown as typeof fetch;

    expect(await verifyTurnstile('secret', 'token', EXPECTED)).toBe(false);
  });

  it('returns false when the siteverify call fails', async () => {
    // Fail closed: a Cloudflare outage must not open the mail-bombing door
    // these two endpoints are behind.
    globalThis.fetch = (() =>
      Promise.reject(new Error('network down'))) as unknown as typeof fetch;

    expect(await verifyTurnstile('secret', 'token', EXPECTED)).toBe(false);
  });

  it('returns false when the answer is not JSON', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response('<html>'))) as unknown as typeof fetch;

    expect(await verifyTurnstile('secret', 'token', EXPECTED)).toBe(false);
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

    await verifyTurnstile('the-secret', 'the-token', EXPECTED);

    expect(seen).toEqual([
      {
        url: SITEVERIFY_URL,
        // No `remoteip`; see `lib/turnstile.ts`.
        body: {secret: 'the-secret', response: 'the-token'},
      },
    ]);
  });

  // #297: a token is good only for the host and the form it was solved on.
  it('refuses a token solved on a host that is not the frontend', async () => {
    siteverifyAnswers({success: true, hostname: 'staging.example.com'});
    expect(await verifyTurnstile('secret', 'token', EXPECTED)).toBe(false);

    siteverifyAnswers({success: true});
    expect(await verifyTurnstile('secret', 'token', EXPECTED)).toBe(false);
  });

  it('refuses a token solved on another form', async () => {
    siteverifyAnswers({
      success: true,
      hostname: 'entry.example.com',
      action: 'password-reset',
    });

    expect(await verifyTurnstile('secret', 'token', EXPECTED)).toBe(false);
  });

  it('takes a token for its own form, or one solved before forms had one', async () => {
    siteverifyAnswers({
      success: true,
      hostname: 'entry.example.com',
      action: 'entry',
    });
    expect(await verifyTurnstile('secret', 'token', EXPECTED)).toBe(true);

    siteverifyAnswers({
      success: true,
      hostname: 'entry.example.com',
      action: '',
    });
    expect(await verifyTurnstile('secret', 'token', EXPECTED)).toBe(true);
  });

  // Local development and the end-to-end run use Cloudflare's test keys,
  // which answer for no host of ours.
  it('checks neither host nor form against a Cloudflare test secret', async () => {
    siteverifyAnswers({success: true, hostname: 'example.com', action: 'x'});

    expect(
      await verifyTurnstile(
        '1x0000000000000000000000000000000AA',
        'XXXX.DUMMY.TOKEN.XXXX',
        EXPECTED,
      ),
    ).toBe(true);
  });
});
