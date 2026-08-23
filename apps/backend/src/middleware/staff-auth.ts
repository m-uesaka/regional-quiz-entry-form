import {createMiddleware} from 'hono/factory';
import {getCookie} from 'hono/cookie';
import {verify} from 'hono/jwt';
import type {Env, StaffClaims} from '../types/env';

const STAFF_SESSION_COOKIE = 'staff_session';

function isStaffClaims(payload: unknown): payload is StaffClaims {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.sub === 'string' &&
    (candidate.role === 'regional' || candidate.role === 'general') &&
    (typeof candidate.regionId === 'string' || candidate.regionId === null) &&
    (candidate.tournamentType === 'saikyoi' ||
      candidate.tournamentType === 'shinjinou' ||
      candidate.tournamentType === null) &&
    typeof candidate.exp === 'number'
  );
}

async function readStaffClaims(
  token: string | undefined,
  secret: string,
): Promise<StaffClaims | null> {
  if (token === undefined) {
    return null;
  }
  try {
    const payload = await verify(token, secret, 'HS256');
    return isStaffClaims(payload) ? payload : null;
  } catch {
    // Expired or tampered token; treat the same as no session.
    return null;
  }
}

/**
 * Restricts a route to authenticated staff with the `general` role.
 *
 * This is a minimal stand-in for the full staff auth/authorization work in
 * Task 6-1 (issuing `staff_session`, `requireStaffForTournament()`). It
 * reads and verifies the same JWT cookie shape so it composes cleanly once
 * that task lands.
 */
export function requireGeneralStaff() {
  return createMiddleware<Env>(async (c, next) => {
    const claims = await readStaffClaims(
      getCookie(c, STAFF_SESSION_COOKIE),
      c.env.SESSION_SECRET,
    );
    if (claims === null) {
      return c.json({error: 'unauthorized'}, 401);
    }
    if (claims.role !== 'general') {
      return c.json({error: 'forbidden'}, 403);
    }
    c.set('staff', claims);
    await next();
  });
}
