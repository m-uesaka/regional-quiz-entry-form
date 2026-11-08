import type {StaffClaims} from '@regional-quiz/shared';

/** A 統括スタッフ session: every region, every tournament type. */
export const GENERAL_STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-000000000001',
  role: 'general',
  regionId: null,
  tournamentType: null,
  sessionsValidFrom: 1756085025678,
};

/** A 地域スタッフ session, covering one region's 最強位 tournament. */
export const REGIONAL_STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-000000000002',
  role: 'regional',
  regionId: '00000000-0000-0000-0000-000000000003',
  tournamentType: 'saikyoi',
  sessionsValidFrom: 1756085025678,
};

/**
 * The `event.locals` of a request `hooks.server.ts` found the given staff
 * session on, and no participant session.
 * @param staff The staff session, or `null` for none.
 */
export function staffLocals(staff: StaffClaims | null): App.Locals {
  return {staff, participant: null};
}
