import {describe, expect, it} from 'vitest';
import type {StaffClaims} from '@regional-quiz/shared';
import {load} from './+layout.server';

const GENERAL_STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-000000000001',
  role: 'general',
  regionId: null,
  tournamentType: null,
  sessionsValidFrom: 1756085025678,
};

const REGIONAL_STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-000000000002',
  role: 'regional',
  regionId: '00000000-0000-0000-0000-000000000003',
  tournamentType: 'saikyoi',
  sessionsValidFrom: 1756085025678,
};

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildEvent(staff: StaffClaims | null): Parameters<typeof load>[0] {
  return {locals: {staff}} as Parameters<typeof load>[0];
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
});
