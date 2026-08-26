import {describe, expect, it} from 'vitest';
import {rewriteApiRequest} from './backend-fetch';

const FRONTEND_URL = new URL('https://entry.example/staff/dashboard');
const BACKEND_URL = 'https://backend.workers.example';

/** Calls `rewriteApiRequest` with the defaults every case shares. */
function rewrite(
  request: Request,
  overrides: {backendUrl?: string | undefined; cookie?: string | null} = {},
): Request | null {
  return rewriteApiRequest({
    request,
    frontendUrl: FRONTEND_URL,
    backendUrl: 'backendUrl' in overrides ? overrides.backendUrl : BACKEND_URL,
    cookie: overrides.cookie ?? null,
  });
}

describe('rewriteApiRequest', () => {
  it('points a same-origin /api request at the backend origin', () => {
    const rewritten = rewrite(
      new Request('https://entry.example/api/staff/dashboard'),
    );

    expect(rewritten?.url).toBe(
      'https://backend.workers.example/api/staff/dashboard',
    );
  });

  it('keeps the query string', () => {
    const rewritten = rewrite(
      new Request('https://entry.example/api/tournaments?regionSlug=kanto'),
    );

    expect(rewritten?.url).toBe(
      'https://backend.workers.example/api/tournaments?regionSlug=kanto',
    );
  });

  it('preserves the method, headers and body', async () => {
    const rewritten = rewrite(
      new Request('https://entry.example/api/entries', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: 'テスト太郎'}),
      }),
    );

    expect(rewritten?.method).toBe('POST');
    expect(rewritten?.headers.get('content-type')).toBe('application/json');
    await expect(rewritten?.text()).resolves.toBe('{"name":"テスト太郎"}');
  });

  it('forwards the incoming cookies to the backend', () => {
    const rewritten = rewrite(
      new Request('https://entry.example/api/mypage/entries'),
      {
        cookie: 'participant_session=token',
      },
    );

    expect(rewritten?.headers.get('cookie')).toBe('participant_session=token');
  });

  it('leaves the cookie header unset when the request carries none', () => {
    const rewritten = rewrite(new Request('https://entry.example/api/healthz'));

    expect(rewritten?.headers.has('cookie')).toBe(false);
  });

  it('rewrites a bare /api request', () => {
    const rewritten = rewrite(new Request('https://entry.example/api'));

    expect(rewritten?.url).toBe('https://backend.workers.example/api');
  });

  it('returns null for a same-origin request outside /api', () => {
    expect(rewrite(new Request('https://entry.example/apiece'))).toBeNull();
    expect(
      rewrite(new Request('https://entry.example/staff/dashboard')),
    ).toBeNull();
  });

  it('returns null for a cross-origin request', () => {
    expect(
      rewrite(new Request('https://other.example/api/healthz')),
    ).toBeNull();
  });

  it('throws when BACKEND_URL is unset', () => {
    expect(() =>
      rewrite(new Request('https://entry.example/api/healthz'), {
        backendUrl: undefined,
      }),
    ).toThrow(/BACKEND_URL is not set/);
  });

  it('throws when BACKEND_URL is not absolute', () => {
    expect(() =>
      rewrite(new Request('https://entry.example/api/healthz'), {
        backendUrl: '/api',
      }),
    ).toThrow(/not an absolute URL/);
  });
});
