import {describe, expect, it} from 'bun:test';
import type {StaffClaims} from '../schemas/staff';
import {canPreviewTournament} from './staff-scope';

const REGION_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_REGION_ID = '22222222-2222-2222-2222-222222222222';

const tournament = {regionId: REGION_ID, type: 'saikyoi'} as const;

const generalStaff: StaffClaims = {
  sub: '99999999-9999-9999-9999-999999999999',
  role: 'general',
  regionId: null,
  tournamentType: null,
};

function regionalStaff(
  regionId: string,
  tournamentType: 'saikyoi' | 'shinjinou',
): StaffClaims {
  return {
    sub: '88888888-8888-8888-8888-888888888888',
    role: 'regional',
    regionId,
    tournamentType,
  };
}

describe('canPreviewTournament', () => {
  it('rejects an anonymous visitor', () => {
    expect(canPreviewTournament(null, tournament)).toBe(false);
  });

  it('accepts general staff for any tournament', () => {
    expect(canPreviewTournament(generalStaff, tournament)).toBe(true);
    expect(
      canPreviewTournament(generalStaff, {
        regionId: OTHER_REGION_ID,
        type: 'shinjinou',
      }),
    ).toBe(true);
  });

  it("accepts the tournament's own regional staff", () => {
    expect(
      canPreviewTournament(regionalStaff(REGION_ID, 'saikyoi'), tournament),
    ).toBe(true);
  });

  it('rejects regional staff of another region', () => {
    expect(
      canPreviewTournament(
        regionalStaff(OTHER_REGION_ID, 'saikyoi'),
        tournament,
      ),
    ).toBe(false);
  });

  it('rejects regional staff of the other tournament type', () => {
    expect(
      canPreviewTournament(regionalStaff(REGION_ID, 'shinjinou'), tournament),
    ).toBe(false);
  });
});
