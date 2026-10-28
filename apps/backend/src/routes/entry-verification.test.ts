import {describe, expect, it} from 'bun:test';
import type {Bindings} from '../types/env';
import {app} from '../index';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';

// Rejected by `zValidator()` before any database call, so it runs
// unconditionally (including CI).
const env: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

describe('POST /entries/verify (request validation)', () => {
  it('rejects a request missing the token with 400', async () => {
    const res = await app.request(
      '/api/entries/verify',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({}),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  // A mail scanner or link preview fetching the old link shape must not
  // reach anything that confirms an entry (#190).
  it('does not confirm on a GET carrying the token', async () => {
    const res = await app.request('/api/entries/verify?token=abc', {}, env);

    expect(res.status).toBe(404);
  });
});
