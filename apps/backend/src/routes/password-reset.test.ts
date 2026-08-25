import {afterEach, describe, expect, it} from 'bun:test';
import {passwordResetRoute} from './password-reset';
import type {Bindings} from '../types/env';

const ENV: Bindings = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

const PARTICIPANT_ID = '44444444-4444-4444-4444-444444444444';

interface MockedTables {
  participants?: Record<string, unknown>[];
  passwordResetTokens?: Record<string, unknown>[];
}

/**
 * Answers the PostgREST and Resend calls the route makes with canned rows.
 * @param tables The rows each table's request resolves to.
 */
function mockFetch(tables: MockedTables): void {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('https://api.resend.com/')) {
      return Promise.resolve(new Response(null, {status: 200}));
    }
    if (url.includes('/password_reset_tokens')) {
      return Promise.resolve(Response.json(tables.passwordResetTokens ?? []));
    }
    return Promise.resolve(Response.json(tables.participants ?? []));
  }) as unknown as typeof fetch;
}

async function post(path: string, body: unknown): Promise<Response> {
  return passwordResetRoute.request(
    path,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    },
    ENV,
  );
}

describe('POST /request', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the same 200 for a registered and an unregistered email', async () => {
    mockFetch({participants: [{id: PARTICIPANT_ID}]});
    const registered = await post('/request', {email: 'known@example.com'});

    mockFetch({participants: []});
    const unregistered = await post('/request', {email: 'unknown@example.com'});

    const registeredBody: unknown = await registered.json();
    const unregisteredBody: unknown = await unregistered.json();
    expect(registered.status).toBe(200);
    expect(unregistered.status).toBe(200);
    expect(registeredBody).toEqual(unregisteredBody);
  });

  it('returns 400 for a malformed email', async () => {
    mockFetch({});

    const res = await post('/request', {email: 'not-an-email'});

    expect(res.status).toBe(400);
  });
});

describe('POST /confirm', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns 200 when the token is consumed', async () => {
    mockFetch({passwordResetTokens: [{participant_id: PARTICIPANT_ID}]});

    const res = await post('/confirm', {
      token: 'a'.repeat(64),
      newPassword: 'brand-new-password',
    });

    // `Response#json()` types as `Promise<any>`; annotate as `unknown` so
    // `expect()` resolves its generic overload instead of the `never` one.
    const body: unknown = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ok: true});
  });

  it('returns 400 when no unused, unexpired token matches', async () => {
    mockFetch({passwordResetTokens: []});

    const res = await post('/confirm', {
      token: 'a'.repeat(64),
      newPassword: 'brand-new-password',
    });

    const body: unknown = await res.json();
    expect(res.status).toBe(400);
    expect(body).toEqual({error: 'invalid or expired token'});
  });

  it('returns 400 for a new password shorter than 8 characters', async () => {
    mockFetch({passwordResetTokens: [{participant_id: PARTICIPANT_ID}]});

    const res = await post('/confirm', {
      token: 'a'.repeat(64),
      newPassword: 'short',
    });

    expect(res.status).toBe(400);
  });
});
