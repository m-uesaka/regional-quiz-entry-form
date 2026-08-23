import {describe, expect, it} from 'bun:test';
import {Hono} from 'hono';
import {sign} from 'hono/jwt';
import type {Bindings, Env, StaffClaims} from '../types/env';
import {requireGeneralStaff} from './staff-auth';

const SESSION_SECRET = 'test-session-secret';

function testEnv(): Bindings {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
    MAIL_API_KEY: 'dummy-mail-api-key',
    SESSION_SECRET,
  };
}

async function signStaffCookie(
  claims: Omit<StaffClaims, 'sub'>,
): Promise<string> {
  const token = await sign(
    {
      sub: 'staff-1',
      ...claims,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

function testApp() {
  return new Hono<Env>().get('/protected', requireGeneralStaff(), c =>
    c.json({staff: c.get('staff')}),
  );
}

describe('requireGeneralStaff', () => {
  it('allows a general staff session', async () => {
    const app = testApp();
    const cookie = await signStaffCookie({
      role: 'general',
      regionId: null,
      tournamentType: null,
    });

    const res = await app.request('/protected', {headers: {cookie}}, testEnv());

    expect(res.status).toBe(200);
  });

  it('rejects a regional staff session with 403', async () => {
    const app = testApp();
    const cookie = await signStaffCookie({
      role: 'regional',
      regionId: 'region-1',
      tournamentType: 'saikyoi',
    });

    const res = await app.request('/protected', {headers: {cookie}}, testEnv());

    expect(res.status).toBe(403);
  });

  it('rejects a missing session with 401', async () => {
    const app = testApp();

    const res = await app.request('/protected', {}, testEnv());

    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret with 401', async () => {
    const app = testApp();
    const token = await sign(
      {
        sub: 'staff-1',
        role: 'general',
        regionId: null,
        tournamentType: null,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      'wrong-secret',
    );

    const res = await app.request(
      '/protected',
      {headers: {cookie: `staff_session=${token}`}},
      testEnv(),
    );

    expect(res.status).toBe(401);
  });
});
