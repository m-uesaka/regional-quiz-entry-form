import type {RequestEvent} from '@sveltejs/kit';
import {describe, expect, it, vi} from 'vitest';
import {handle, handleFetch} from './hooks.server';

const FORWARD_SECRET = 'test-client-ip-forward-secret';

// A SvelteKit virtual module, which only exists inside a running app. No
// session secret: every request below is an anonymous one, which is all the
// headers are about. The backend and the forwarding secret are what
// `handleFetch` reads.
vi.mock('$env/dynamic/private', () => ({
  env: {
    BACKEND_URL: 'https://backend.workers.example',
    CLIENT_IP_FORWARD_SECRET: 'test-client-ip-forward-secret',
  },
}));

/**
 * Runs `handle` for `path` the way SvelteKit would, with a `resolve` that
 * answers a bare page, and returns the response it produced.
 */
async function respond(path: string, method = 'GET'): Promise<Response> {
  const url = new URL(path, 'https://entry.example');
  const event = {
    url,
    request: new Request(url, {method}),
    cookies: {get: () => undefined},
    locals: {},
    platform: undefined,
  } as unknown as RequestEvent;
  const resolve = () =>
    Promise.resolve(
      new Response('<!doctype html>', {headers: {'content-type': 'text/html'}}),
    );
  return await handle({event, resolve});
}

describe('handle: security headers (#120)', () => {
  it('a mypage response is marked private, no-store', async () => {
    const res = await respond('/mypage');

    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('staff and admin responses are marked private, no-store', async () => {
    for (const path of [
      '/staff/dashboard',
      '/staff/login',
      '/admin/regions',
      '/mypage/entries/1',
    ]) {
      const res = await respond(path);

      expect(res.headers.get('cache-control'), path).toBe('private, no-store');
    }
  });

  it('a public entry list response is not marked no-store', async () => {
    const res = await respond('/tokyo/spring-2026/list');

    expect(res.headers.get('cache-control')).toBeNull();
  });

  it('a path that only starts like a private one is not marked no-store', async () => {
    const res = await respond('/staffroom');

    expect(res.headers.get('cache-control')).toBeNull();
  });

  it('every response carries a Referrer-Policy and X-Content-Type-Options', async () => {
    for (const path of ['/', '/mypage', '/tokyo/spring-2026/entry']) {
      const res = await respond(path);

      expect(res.headers.get('referrer-policy'), path).toBe(
        'strict-origin-when-cross-origin',
      );
      expect(res.headers.get('x-content-type-options'), path).toBe('nosniff');
    }
  });

  it('a page opened with a token in its URL sends no Referer to another site', async () => {
    for (const path of [
      '/verify?token=abc',
      '/password-reset?token=abc',
      '/staff/password-reset?token=abc',
    ]) {
      const res = await respond(path);

      expect(res.headers.get('referrer-policy'), path).toBe('same-origin');
      expect(res.headers.get('cache-control'), path).toBe('private, no-store');
    }
  });

  it('the password reset request form keeps the default policy for Turnstile', async () => {
    const res = await respond('/password-reset');

    expect(res.headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(res.headers.get('cache-control')).toBeNull();
  });

  // A form submission's answer is rendered from what was just typed in --
  // on the public entry form, the participant's name and address.
  it('the answer to a form submission is marked no-store on any page', async () => {
    const res = await respond('/tokyo/saikyoi/entry', 'POST');

    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('the entry form itself stays cacheable', async () => {
    const res = await respond('/tokyo/saikyoi/entry');

    expect(res.headers.get('cache-control')).toBeNull();
  });
});

describe('handleFetch: the client-IP forwarding secret (#188)', () => {
  /**
   * Runs `handleFetch` for `request` while serving a page, and returns the
   * request it handed to the network.
   * @param request What the page's `load` or action fetched.
   */
  async function sentFor(request: Request): Promise<Request> {
    const url = new URL('https://entry.example/tokyo/saikyoi/entry');
    const event = {
      url,
      request: new Request(url),
      cookies: {set: vi.fn(), delete: vi.fn()},
      getClientAddress: () => '198.51.100.4',
    } as unknown as RequestEvent;
    const sent: Request[] = [];
    const fetch = (input: RequestInfo | URL) => {
      sent.push(input as Request);
      return Promise.resolve(new Response('{}'));
    };
    await handleFetch({
      event,
      request,
      fetch: fetch as typeof globalThis.fetch,
    });
    expect(sent).toHaveLength(1);
    return sent[0];
  }

  it('sends the secret with a call to the backend', async () => {
    const sent = await sentFor(
      new Request('https://entry.example/api/entries'),
    );

    expect(sent.url).toBe('https://backend.workers.example/api/entries');
    expect(sent.headers.get('x-client-ip-forward-secret')).toBe(FORWARD_SECRET);
  });

  // Every other fetch goes out as it came in; the secret must not ride
  // along to a third party, or with it the power to pick any address.
  it('never sends the secret anywhere else', async () => {
    for (const target of [
      'https://elsewhere.example/api/entries',
      'https://entry.example/tokyo/saikyoi/list',
    ]) {
      const sent = await sentFor(
        new Request(target, {
          headers: {'X-Client-IP-Forward-Secret': 'from-the-page'},
        }),
      );

      expect(sent.url, target).toBe(target);
      expect(sent.headers.get('x-client-ip-forward-secret'), target).not.toBe(
        FORWARD_SECRET,
      );
      expect(sent.headers.has('x-client-ip'), target).toBe(false);
    }
  });
});
