import {describe, expect, it} from 'vitest';
import type {HttpError, Redirect} from '@sveltejs/kit';
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

/** Builds the partial `RequestEvent` `load` reads, cast for test use. */
function buildEvent(
  staff: StaffClaims | null,
  jar: FakeCookieJar = fakeCookieJar(),
): Parameters<typeof load>[0] {
  return {
    locals: staffLocals(staff),
    url: new URL('http://localhost/admin/regions'),
    cookies: jar.cookies,
  } as Parameters<typeof load>[0];
}

describe('admin +layout.server load', () => {
  it('redirects an anonymous visitor to the staff login', () => {
    expect(() => load(buildEvent(null))).toThrowError(
      expect.objectContaining({
        status: 303,
        location: '/staff/login?redirectTo=%2Fadmin%2Fregions',
      } satisfies Partial<Redirect>),
    );
  });

  it('rejects regional staff with 403', () => {
    expect(() => load(buildEvent(REGIONAL_STAFF))).toThrowError(
      expect.objectContaining({status: 403} satisfies Partial<HttpError>),
    );
  });

  it('lets general staff through and hands the layout their claims', () => {
    expect(load(buildEvent(GENERAL_STAFF))).toEqual({staff: GENERAL_STAFF});
  });

  it('warns about the accounts the login found still waiting on their invite', () => {
    const jar = fakeCookieJar({
      [STAFF_PENDING_INVITES_COOKIE]: 'saikyoi,shinjinou',
    });

    expect(load(buildEvent(GENERAL_STAFF, jar))).toEqual({
      staff: GENERAL_STAFF,
      pendingInvitesMessage: expect.stringContaining(
        '「最強位の地域スタッフ・新人王の地域スタッフ」',
      ),
    });
    expect(jar.deleted).toEqual([STAFF_PENDING_INVITES_COOKIE]);
  });
});
