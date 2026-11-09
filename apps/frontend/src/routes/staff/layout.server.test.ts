import {describe, expect, it} from 'vitest';
import type {StaffClaims} from '@regional-quiz/shared';
import {
  GENERAL_STAFF,
  REGIONAL_STAFF,
  staffLocals,
} from '../../test-support/staff-locals';
import {
  fakeCookieJar,
  type FakeCookieJar,
} from '../../test-support/fake-cookies';
import {STAFF_PENDING_INVITES_COOKIE} from '$lib/server/staff-pending-invites';
import {load} from './+layout.server';

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildEvent(
  staff: StaffClaims | null,
  jar: FakeCookieJar = fakeCookieJar(),
): Parameters<typeof load>[0] {
  return {locals: staffLocals(staff), cookies: jar.cookies} as Parameters<
    typeof load
  >[0];
}

describe('staff +layout.server load', () => {
  it('reports no session on the login screen', () => {
    expect(load(buildEvent(null))).toEqual({
      loggedIn: false,
      isGeneralStaff: false,
    });
  });

  it('marks general staff, who may open the dashboard', () => {
    expect(load(buildEvent(GENERAL_STAFF))).toEqual({
      loggedIn: true,
      isGeneralStaff: true,
    });
  });

  it('does not mark regional staff, whom the dashboard refuses', () => {
    expect(load(buildEvent(REGIONAL_STAFF))).toEqual({
      loggedIn: true,
      isGeneralStaff: false,
    });
  });

  it('warns once about the accounts the login found still waiting on their invite', () => {
    const jar = fakeCookieJar({[STAFF_PENDING_INVITES_COOKIE]: 'shinjinou'});

    expect(load(buildEvent(REGIONAL_STAFF, jar))).toEqual({
      loggedIn: true,
      isGeneralStaff: false,
      pendingInvitesMessage: expect.stringMatching(
        /「新人王の地域スタッフ」.*招待メールのリンク/,
      ),
    });
    expect(jar.deleted).toEqual([STAFF_PENDING_INVITES_COOKIE]);
    expect(load(buildEvent(REGIONAL_STAFF, jar))).not.toHaveProperty(
      'pendingInvitesMessage',
    );
  });

  it('leaves the warning alone on the login screen', () => {
    const jar = fakeCookieJar({[STAFF_PENDING_INVITES_COOKIE]: 'shinjinou'});

    expect(load(buildEvent(null, jar))).not.toHaveProperty(
      'pendingInvitesMessage',
    );
    expect(jar.deleted).toEqual([]);
  });
});
