import {describe, expect, it} from 'bun:test';
import {Hono} from 'hono';
import {sign} from 'hono/jwt';
import {
  requireParticipant,
  PARTICIPANT_SESSION_COOKIE,
} from './participant-auth';
import type {Bindings, ParticipantEnv} from '../types/env';

const SESSION_SECRET = 'test-session-secret';
const ENV: Bindings = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET,
};

const PARTICIPANT_ID = '44444444-4444-4444-4444-444444444444';

async function tokenFor(claims: Record<string, unknown>): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return sign({...claims, exp}, SESSION_SECRET);
}

function cookieHeader(token: string): {Cookie: string} {
  return {Cookie: `${PARTICIPANT_SESSION_COOKIE}=${token}`};
}

describe('requireParticipant', () => {
  const app = new Hono<ParticipantEnv>().get('/x', requireParticipant(), c =>
    c.json({participantId: c.get('participantId')}),
  );

  it('sets participantId from a valid token', async () => {
    const token = await tokenFor({sub: PARTICIPANT_ID});

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({participantId: PARTICIPANT_ID});
  });

  it('returns 401 when the cookie is missing', async () => {
    const res = await app.request('/x', {}, ENV);

    expect(res.status).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    const token = await sign(
      {
        sub: PARTICIPANT_ID,
        exp: Math.floor(Date.now() / 1000) - 3600,
      },
      SESSION_SECRET,
    );

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(401);
  });

  it('returns 401 for a tampered token', async () => {
    const token = await tokenFor({sub: PARTICIPANT_ID});
    // Flip the *first* character of the signature segment rather than the
    // token's last character: base64url's final character of a 32-byte
    // HMAC signature only encodes 4 significant bits (the other 2 are
    // unused padding), so toggling it there sometimes decodes to the same
    // signature bytes and the token verifies as valid anyway (flaky).
    const [header, payload, signature] = token.split('.');
    const tamperedSignature =
      (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
    const tampered = `${header}.${payload}.${tamperedSignature}`;

    const res = await app.request('/x', {headers: cookieHeader(tampered)}, ENV);

    expect(res.status).toBe(401);
  });

  it('returns 401 for a validly signed token with no exp claim', async () => {
    const token = await sign({sub: PARTICIPANT_ID}, SESSION_SECRET);

    const res = await app.request('/x', {headers: cookieHeader(token)}, ENV);

    expect(res.status).toBe(401);
  });
});
