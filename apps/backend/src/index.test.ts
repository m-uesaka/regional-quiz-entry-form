import {describe, expect, it} from 'bun:test';
import {app} from './index';
import {PERMISSIVE_PLATFORM_BINDINGS} from './test-support/bindings';
import type {Bindings} from './types/env';

const FRONTEND_URL = 'https://entry.example.com';
const FOREIGN_ORIGIN = 'https://evil.example';

// Only `FRONTEND_URL` matters to the origin check; the rest is filler so the
// literal typechecks. Nothing below reaches Supabase or the mail provider.
const ENV: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL: 'http://127.0.0.1:1',
  SUPABASE_SECRET_KEY: 'dummy-secret-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL,
  SESSION_SECRET: 'dummy-session-secret',
};

// A state-changing endpoint that needs neither a session nor a database, so
// what answers is the origin check and nothing else. Posted with no body, it
// looks to `hono/csrf` exactly like a cross-site `<form>` submission would.
const LOGOUT_PATH = '/api/auth/participant/logout';

async function postLogout(
  headers: Record<string, string>,
  env: Bindings = ENV,
): Promise<Response> {
  return await app.request(LOGOUT_PATH, {method: 'POST', headers}, env);
}

describe('GET /api/healthz', () => {
  it('returns ok', async () => {
    const res = await app.request('/api/healthz');
    // `Response#json()` types as `Promise<any>`; annotate as `unknown` so
    // `expect()` resolves its generic overload instead of the `never` one.
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ok: true});
  });
});

describe('origin check (#120)', () => {
  it('a state-changing request from a foreign origin is refused', async () => {
    const res = await postLogout({origin: FOREIGN_ORIGIN});

    expect(res.status).toBe(403);
    // Refused before the handler ran, so no cookie was touched.
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('a form-encoded request from a foreign origin is refused', async () => {
    const res = await postLogout({
      origin: FOREIGN_ORIGIN,
      'content-type': 'application/x-www-form-urlencoded',
    });

    expect(res.status).toBe(403);
  });

  it('a state-changing request with no origin at all is refused', async () => {
    const res = await postLogout({});

    expect(res.status).toBe(403);
  });

  it('a request from FRONTEND_URL is allowed', async () => {
    const res = await postLogout({origin: FRONTEND_URL});

    expect(res.status).toBe(200);
  });

  it('a FRONTEND_URL written with a trailing slash still matches', async () => {
    const res = await postLogout(
      {origin: FRONTEND_URL},
      {...ENV, FRONTEND_URL: `${FRONTEND_URL}/`},
    );

    expect(res.status).toBe(200);
  });

  it('a FRONTEND_URL that is not a URL refuses rather than allows', async () => {
    const res = await postLogout(
      {origin: FRONTEND_URL},
      {...ENV, FRONTEND_URL: 'entry.example.com'},
    );

    expect(res.status).toBe(403);
  });

  it('a request the browser marks same-origin is allowed', async () => {
    // The browser's own `/api/*` calls go through the route on the frontend
    // host, so the browser marks them same-origin.
    const res = await postLogout({'sec-fetch-site': 'same-origin'});

    expect(res.status).toBe(200);
  });

  it('a GET is not subject to the origin check', async () => {
    const res = await app.request(
      '/api/healthz',
      {headers: {origin: FOREIGN_ORIGIN}},
      ENV,
    );

    expect(res.status).toBe(200);
  });
});

describe('secure headers (#120)', () => {
  it('every response carries the secure headers', async () => {
    const responses = [
      await app.request('/api/healthz', {}, ENV),
      // The origin check's refusal, which is thrown rather than returned.
      await postLogout({origin: FOREIGN_ORIGIN}),
      await app.request('/api/no-such-route', {}, ENV),
    ];

    for (const res of responses) {
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('strict-transport-security')).toContain(
        'max-age=',
      );
    }
  });
});
