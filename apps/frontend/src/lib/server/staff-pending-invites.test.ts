import {describe, expect, it} from 'vitest';
import {fakeCookieJar} from '../../test-support/fake-cookies';
import {
  pendingInvitesData,
  rememberPendingInvites,
  STAFF_PENDING_INVITES_COOKIE,
  takePendingInvites,
} from './staff-pending-invites';

describe('rememberPendingInvites', () => {
  it('writes nothing when no account is waiting', () => {
    const jar = fakeCookieJar();

    rememberPendingInvites(jar.cookies, []);

    expect(jar.jar.size).toBe(0);
  });
});

describe('takePendingInvites', () => {
  it('reads back what the login remembered, once', () => {
    const jar = fakeCookieJar();
    rememberPendingInvites(jar.cookies, ['shinjinou', 'general']);

    expect(takePendingInvites(jar.cookies)).toEqual(['shinjinou', 'general']);
    expect(takePendingInvites(jar.cookies)).toEqual([]);
  });

  it('drops anything that is not a scope', () => {
    const jar = fakeCookieJar({
      [STAFF_PENDING_INVITES_COOKIE]: '<script>,general,saikyoi',
    });

    expect(takePendingInvites(jar.cookies)).toEqual(['saikyoi', 'general']);
  });
});

describe('pendingInvitesData', () => {
  it('adds nothing when no account is waiting', () => {
    expect(pendingInvitesData([])).toEqual({});
  });

  it('names the waiting accounts as the login screen does', () => {
    expect(
      pendingInvitesData(['shinjinou', 'general']).pendingInvitesMessage,
    ).toContain('「新人王の地域スタッフ・統括スタッフ」');
  });
});
