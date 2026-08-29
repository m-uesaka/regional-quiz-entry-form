import {describe, expect, it} from 'vitest';
import type {HttpError, Redirect} from '@sveltejs/kit';
import type {StaffClaims} from '@regional-quiz/shared';
import {load} from './+layout.server';

const GENERAL_STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-000000000001',
  role: 'general',
  regionId: null,
  tournamentType: null,
};

const REGIONAL_STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-000000000002',
  role: 'regional',
  regionId: '00000000-0000-0000-0000-000000000003',
  tournamentType: 'saikyoi',
};

/** Builds the partial `RequestEvent` `load` reads, cast for test use. */
function buildEvent(staff: StaffClaims | null): Parameters<typeof load>[0] {
  return {
    locals: {staff, participant: null},
    url: new URL('http://localhost/admin/regions'),
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
});
