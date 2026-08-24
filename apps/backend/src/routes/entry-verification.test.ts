import {describe, expect, it} from 'bun:test';
import type {Bindings} from '../types/env';
import app from '../index';

// Rejected by `zValidator()` before any database call, so it runs
// unconditionally (including CI).
const env: Bindings = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

describe('GET /entries/verify (request validation)', () => {
  it('rejects a request missing the token query param with 400', async () => {
    const res = await app.request('/api/entries/verify', {}, env);

    expect(res.status).toBe(400);
  });
});
