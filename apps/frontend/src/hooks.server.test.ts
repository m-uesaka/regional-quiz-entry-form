import type {RequestEvent} from '@sveltejs/kit';
import {describe, expect, it, vi} from 'vitest';
import {handle} from './hooks.server';

// A SvelteKit virtual module, which only exists inside a running app. No
// session secret: every request below is an anonymous one, which is all the
// headers are about.
vi.mock('$env/dynamic/private', () => ({env: {}}));

/**
 * Runs `handle` for `path` the way SvelteKit would, with a `resolve` that
 * answers a bare page, and returns the response it produced.
 */
async function respond(path: string): Promise<Response> {
  const url = new URL(path, 'https://entry.example');
  const event = {
    url,
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
});
