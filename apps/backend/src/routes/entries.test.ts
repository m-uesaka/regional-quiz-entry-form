import {describe, expect, it} from 'bun:test';
import type {Bindings} from '../types/env';
import app from '../index';

// These requests are rejected by `zValidator()` before any database call,
// so they run unconditionally (including CI).
const env: Bindings = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

const validBody = {
  name: '山田太郎',
  furigana: 'ヤマダタロウ',
  displayName: '太郎',
  email: 'entrant@example.com',
  password: 'password123',
  passwordConfirm: 'password123',
  regulationId: '11111111-1111-1111-1111-111111111111',
  customFieldValues: {},
};

describe('POST /tournaments/:tournamentId/entries (request validation)', () => {
  it('rejects a non-UUID tournamentId with 400', async () => {
    const res = await app.request(
      '/api/tournaments/not-a-uuid/entries',
      {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(validBody),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  it('rejects a body missing required fields with 400', async () => {
    const res = await app.request(
      '/api/tournaments/22222222-2222-2222-2222-222222222222/entries',
      {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({...validBody, email: undefined}),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  it('rejects mismatched password confirmation with 400', async () => {
    const res = await app.request(
      '/api/tournaments/22222222-2222-2222-2222-222222222222/entries',
      {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({...validBody, passwordConfirm: 'different'}),
      },
      env,
    );

    expect(res.status).toBe(400);
  });
});
