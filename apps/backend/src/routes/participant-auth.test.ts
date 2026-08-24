import {afterEach, describe, expect, it} from 'bun:test';
import {participantAuthRoute} from './participant-auth';
import {hashPassword} from '../lib/password';
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

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payloadSegment = token.split('.')[1];
  const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64)) as Record<string, unknown>;
}

function mockParticipantFetch(row: Record<string, unknown> | null): void {
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json(row ? [row] : []),
    )) as unknown as typeof fetch;
}

describe('POST /login', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('succeeds with correct credentials and sets a JWT cookie signed with SESSION_SECRET', async () => {
    mockParticipantFetch({
      id: PARTICIPANT_ID,
      password_hash: await hashPassword('correct-password'),
    });

    const res = await participantAuthRoute.request(
      '/login',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          email: 'participant@example.com',
          password: 'correct-password',
        }),
      },
      ENV,
    );

    expect(res.status).toBe(200);

    const setCookieHeader = res.headers.get('set-cookie') ?? '';
    expect(setCookieHeader).toContain('participant_session=');
    expect(setCookieHeader).toContain('HttpOnly');

    const token = setCookieHeader
      .split('participant_session=')[1]
      .split(';')[0];
    expect(decodeJwtPayload(token)).toMatchObject({sub: PARTICIPANT_ID});
  });

  it('returns 401 for a wrong password', async () => {
    mockParticipantFetch({
      id: PARTICIPANT_ID,
      password_hash: await hashPassword('correct-password'),
    });

    const res = await participantAuthRoute.request(
      '/login',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          email: 'participant@example.com',
          password: 'wrong-password',
        }),
      },
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it('returns 401 for a non-existent email', async () => {
    mockParticipantFetch(null);

    const res = await participantAuthRoute.request(
      '/login',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          email: 'unknown@example.com',
          password: 'anything',
        }),
      },
      ENV,
    );

    expect(res.status).toBe(401);
  });
});
