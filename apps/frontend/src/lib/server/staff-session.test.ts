import {describe, expect, it} from 'vitest';
import {sign} from 'hono/jwt';
import type {StaffClaims} from '@regional-quiz/shared';
import {readStaffClaims} from './staff-session';

const SESSION_SECRET = 'test-session-secret';
const WRONG_SECRET = 'wrong-session-secret';

const STAFF_CLAIMS: StaffClaims = {
  sub: '33333333-3333-3333-3333-333333333333',
  role: 'general',
  regionId: null,
  tournamentType: null,
};

/** Signs `claims` (plus the given `exp`, if provided) with `secret`. */
async function tokenFor(
  claims: Record<string, unknown>,
  exp: number | undefined,
  secret: string,
): Promise<string> {
  return sign(exp === undefined ? claims : {...claims, exp}, secret);
}

describe('readStaffClaims', () => {
  it('returns null when the token is missing', async () => {
    await expect(
      readStaffClaims(undefined, SESSION_SECRET),
    ).resolves.toBeNull();
  });

  it('returns null when the secret is missing', async () => {
    const token = await tokenFor(
      STAFF_CLAIMS,
      Math.floor(Date.now() / 1000) + 3600,
      SESSION_SECRET,
    );

    await expect(readStaffClaims(token, undefined)).resolves.toBeNull();
  });

  it('returns the parsed claims for a validly signed, unexpired token', async () => {
    const token = await tokenFor(
      STAFF_CLAIMS,
      Math.floor(Date.now() / 1000) + 3600,
      SESSION_SECRET,
    );

    await expect(readStaffClaims(token, SESSION_SECRET)).resolves.toEqual(
      STAFF_CLAIMS,
    );
  });

  it('returns null for an expired token', async () => {
    const token = await tokenFor(
      STAFF_CLAIMS,
      Math.floor(Date.now() / 1000) - 3600,
      SESSION_SECRET,
    );

    await expect(readStaffClaims(token, SESSION_SECRET)).resolves.toBeNull();
  });

  it('returns null for a validly signed token with no exp claim', async () => {
    const token = await tokenFor(STAFF_CLAIMS, undefined, SESSION_SECRET);

    await expect(readStaffClaims(token, SESSION_SECRET)).resolves.toBeNull();
  });

  it('returns null for a malformed token', async () => {
    await expect(
      readStaffClaims('not-a-real-token', SESSION_SECRET),
    ).resolves.toBeNull();
  });

  it('returns null for a token signed with the wrong secret', async () => {
    const token = await tokenFor(
      STAFF_CLAIMS,
      Math.floor(Date.now() / 1000) + 3600,
      WRONG_SECRET,
    );

    await expect(readStaffClaims(token, SESSION_SECRET)).resolves.toBeNull();
  });
});
