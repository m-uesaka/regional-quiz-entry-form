import {describe, expect, it} from 'vitest';
import {sign} from 'hono/jwt';
import type {Cookies} from '@sveltejs/kit';
import type {ParticipantClaims} from '@regional-quiz/shared';
import {
  clearParticipantSession,
  readParticipantClaims,
  redirectToParticipantLogin,
} from './participant-session';

const SESSION_SECRET = 'test-session-secret';
const WRONG_SECRET = 'wrong-session-secret';

const PARTICIPANT_CLAIMS: ParticipantClaims = {
  sub: '44444444-4444-4444-4444-444444444444',
  pwdChangedAt: Date.parse('2026-08-25T01:23:45.678Z'),
};

/** Signs `claims` (plus the given `exp`, if provided) with `secret`. */
async function tokenFor(
  claims: Record<string, unknown>,
  exp: number | undefined,
  secret: string,
): Promise<string> {
  return sign(exp === undefined ? claims : {...claims, exp}, secret);
}

describe('readParticipantClaims', () => {
  it('returns null when the token is missing', async () => {
    await expect(
      readParticipantClaims(undefined, SESSION_SECRET),
    ).resolves.toBeNull();
  });

  it('returns null when the secret is missing', async () => {
    const token = await tokenFor(
      PARTICIPANT_CLAIMS,
      Math.floor(Date.now() / 1000) + 3600,
      SESSION_SECRET,
    );

    await expect(readParticipantClaims(token, undefined)).resolves.toBeNull();
  });

  it('returns the parsed claims for a validly signed, unexpired token', async () => {
    const token = await tokenFor(
      PARTICIPANT_CLAIMS,
      Math.floor(Date.now() / 1000) + 3600,
      SESSION_SECRET,
    );

    await expect(readParticipantClaims(token, SESSION_SECRET)).resolves.toEqual(
      PARTICIPANT_CLAIMS,
    );
  });

  it('returns null for an expired token', async () => {
    const token = await tokenFor(
      PARTICIPANT_CLAIMS,
      Math.floor(Date.now() / 1000) - 3600,
      SESSION_SECRET,
    );

    await expect(
      readParticipantClaims(token, SESSION_SECRET),
    ).resolves.toBeNull();
  });

  it('returns null for a validly signed token with no exp claim', async () => {
    const token = await tokenFor(PARTICIPANT_CLAIMS, undefined, SESSION_SECRET);

    await expect(
      readParticipantClaims(token, SESSION_SECRET),
    ).resolves.toBeNull();
  });

  it('returns null for a validly signed token with no pwdChangedAt claim', async () => {
    // The backend refuses these too: without the claim a session can't be
    // shown to have been issued for the password that is current now (see
    // `apps/backend/src/middleware/participant-auth.ts`), so the two sides
    // have to agree on rejecting them.
    const token = await tokenFor(
      {sub: PARTICIPANT_CLAIMS.sub},
      Math.floor(Date.now() / 1000) + 3600,
      SESSION_SECRET,
    );

    await expect(
      readParticipantClaims(token, SESSION_SECRET),
    ).resolves.toBeNull();
  });

  it('returns null for a malformed token', async () => {
    await expect(
      readParticipantClaims('not-a-real-token', SESSION_SECRET),
    ).resolves.toBeNull();
  });

  it('returns null for a token signed with the wrong secret', async () => {
    const token = await tokenFor(
      PARTICIPANT_CLAIMS,
      Math.floor(Date.now() / 1000) + 3600,
      WRONG_SECRET,
    );

    await expect(
      readParticipantClaims(token, SESSION_SECRET),
    ).resolves.toBeNull();
  });
});

interface DeletedCookie {
  name: string;
  options: Parameters<Cookies['delete']>[1];
}

/** Builds a stand-in for `event.cookies` that records what it deleted. */
function fakeCookies(deleted: DeletedCookie[]): Cookies {
  return {
    delete: (name: string, options: Parameters<Cookies['delete']>[1]) =>
      deleted.push({name, options}),
  } as unknown as Cookies;
}

describe('clearParticipantSession', () => {
  it('deletes the session cookie under the path the backend set it on', () => {
    const deleted: DeletedCookie[] = [];

    clearParticipantSession(fakeCookies(deleted));

    expect(deleted).toEqual([
      {name: 'participant_session', options: {path: '/'}},
    ]);
  });
});

describe('redirectToParticipantLogin', () => {
  it('clears the refused session on the way to the login form', () => {
    const deleted: DeletedCookie[] = [];

    expect(() => redirectToParticipantLogin(fakeCookies(deleted))).toThrow(
      expect.objectContaining({status: 303, location: '/mypage/login'}),
    );
    // A cookie left in place would be read as a session by
    // `readParticipantClaims`, which cannot see that the API has stopped
    // honouring it -- so the login page would send it straight back.
    expect(deleted.map(cookie => cookie.name)).toEqual(['participant_session']);
  });
});
