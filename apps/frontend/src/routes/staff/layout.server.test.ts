import {describe, expect, it} from 'vitest';
import type {StaffClaims} from '@regional-quiz/shared';
import {
  GENERAL_STAFF,
  REGIONAL_STAFF,
  staffLocals,
} from '../../test-support/staff-locals';
import {load} from './+layout.server';

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildEvent(staff: StaffClaims | null): Parameters<typeof load>[0] {
  return {locals: staffLocals(staff)} as Parameters<typeof load>[0];
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
