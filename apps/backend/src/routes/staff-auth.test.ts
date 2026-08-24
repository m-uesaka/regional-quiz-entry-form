import {afterEach, describe, expect, it} from 'bun:test';
import {staffAuthRoute} from './staff-auth';
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

const STAFF_ID = '33333333-3333-3333-3333-333333333333';
const REGION_ID = '11111111-1111-1111-1111-111111111111';

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payloadSegment = token.split('.')[1];
  const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64)) as Record<string, unknown>;
}

function mockStaffAccountFetch(row: Record<string, unknown> | null): void {
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

  it('issues a JWT cookie whose claims include role, regionId, and tournamentType', async () => {
    mockStaffAccountFetch({
      id: STAFF_ID,
      password_hash: await hashPassword('correct-password'),
      role: 'regional',
      region_id: REGION_ID,
      tournament_type: 'saikyoi',
    });

    const res = await staffAuthRoute.request(
      '/login',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          email: 'staff@example.com',
          password: 'correct-password',
        }),
      },
      ENV,
    );

    expect(res.status).toBe(200);

    const setCookieHeader = res.headers.get('set-cookie') ?? '';
    expect(setCookieHeader).toContain('staff_session=');
    expect(setCookieHeader).toContain('HttpOnly');

    const token = setCookieHeader.split('staff_session=')[1].split(';')[0];
    expect(decodeJwtPayload(token)).toMatchObject({
      sub: STAFF_ID,
      role: 'regional',
      regionId: REGION_ID,
      tournamentType: 'saikyoi',
    });
  });

  it('returns 401 for a wrong password', async () => {
    mockStaffAccountFetch({
      id: STAFF_ID,
      password_hash: await hashPassword('correct-password'),
      role: 'regional',
      region_id: REGION_ID,
      tournament_type: 'saikyoi',
    });

    const res = await staffAuthRoute.request(
      '/login',
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          email: 'staff@example.com',
          password: 'wrong-password',
        }),
      },
      ENV,
    );

    expect(res.status).toBe(401);
  });

  it('returns 401 when no staff account matches the email', async () => {
    mockStaffAccountFetch(null);

    const res = await staffAuthRoute.request(
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
