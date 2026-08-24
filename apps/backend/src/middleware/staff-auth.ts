import {createMiddleware} from 'hono/factory';
import {getCookie} from 'hono/cookie';
import {verify} from 'hono/jwt';
import {
  StaffClaimsSchema,
  type StaffClaims,
  type TournamentType,
} from '@regional-quiz/shared';
import type {StaffEnv} from '../types/env';
import {createDbClient} from '../lib/db';

export const STAFF_SESSION_COOKIE = 'staff_session';

interface TournamentScopeRow {
  region_id: string;
  type: TournamentType;
}

async function readStaffClaims(
  token: string | undefined,
  secret: string,
): Promise<StaffClaims | null> {
  if (!token) return null;
  try {
    const payload = await verify(token, secret, 'HS256');
    // hono/jwt's `verify()` only checks expiration when an `exp` claim is
    // present, so a correctly signed token without one would otherwise be
    // treated as a valid session indefinitely.
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as Record<string, unknown>).exp !== 'number'
    ) {
      return null;
    }
    return StaffClaimsSchema.parse(payload);
  } catch {
    // Covers both an invalid/expired signature (thrown by `verify`) and
    // claims that don't match the expected shape (thrown by `.parse`).
    return null;
  }
}

export function requireGeneralStaff() {
  return createMiddleware<StaffEnv>(async (c, next) => {
    const staff = await readStaffClaims(
      getCookie(c, STAFF_SESSION_COOKIE),
      c.env.SESSION_SECRET,
    );
    if (!staff) {
      return c.json({error: 'unauthorized'}, 401);
    }
    if (staff.role !== 'general') {
      return c.json({error: 'forbidden'}, 403);
    }
    c.set('staff', staff);
    await next();
  });
}

/** Whether `staff`'s region/tournament-type claims cover `tournament`. */
function isInScope(
  staff: StaffClaims,
  tournament: TournamentScopeRow | null,
): boolean {
  return (
    tournament !== null &&
    staff.regionId === tournament.region_id &&
    staff.tournamentType === tournament.type
  );
}

export function requireStaffForTournament() {
  return createMiddleware<StaffEnv>(async (c, next) => {
    const staff = await readStaffClaims(
      getCookie(c, STAFF_SESSION_COOKIE),
      c.env.SESSION_SECRET,
    );
    if (!staff) {
      return c.json({error: 'unauthorized'}, 401);
    }

    if (staff.role !== 'general') {
      const db = createDbClient(c.env);
      const {data: tournament, error} = await db
        .from('tournaments')
        .select('region_id, type')
        .eq('id', c.req.param('tournamentId'))
        .returns<TournamentScopeRow[]>()
        .maybeSingle();

      if (error) {
        return c.json({error: 'internal server error'}, 500);
      }

      if (!isInScope(staff, tournament)) {
        return c.json({error: 'forbidden'}, 403);
      }
    }

    c.set('staff', staff);
    await next();
  });
}

interface EntryScopeRow {
  tournaments: TournamentScopeRow | null;
}

/**
 * Same scope check as `requireStaffForTournament()`, but for routes keyed by
 * an `:entryId` param instead of `:tournamentId` (e.g. the single-entry
 * detail endpoint) — the tournament to check scope against is looked up via
 * the entry's `tournament_id` foreign key.
 */
export function requireStaffForEntry() {
  return createMiddleware<StaffEnv>(async (c, next) => {
    const staff = await readStaffClaims(
      getCookie(c, STAFF_SESSION_COOKIE),
      c.env.SESSION_SECRET,
    );
    if (!staff) {
      return c.json({error: 'unauthorized'}, 401);
    }

    if (staff.role !== 'general') {
      const db = createDbClient(c.env);
      const {data: entry, error} = await db
        .from('entries')
        .select('tournaments(region_id, type)')
        .eq('id', c.req.param('entryId'))
        .returns<EntryScopeRow[]>()
        .maybeSingle();

      if (error) {
        return c.json({error: 'internal server error'}, 500);
      }

      if (!isInScope(staff, entry?.tournaments ?? null)) {
        return c.json({error: 'forbidden'}, 403);
      }
    }

    c.set('staff', staff);
    await next();
  });
}
