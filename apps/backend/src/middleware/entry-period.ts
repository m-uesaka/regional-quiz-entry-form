import type {Context} from 'hono';
import {createMiddleware} from 'hono/factory';
import {getCookie} from 'hono/cookie';
import {isWithinEntryPeriod} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {
  fetchTournamentById,
  fetchTournamentBySlug,
  tournamentLookupFailure,
  type TournamentRow,
} from '../lib/tournaments';
import {
  isInScope,
  isSessionCurrent,
  readStaffClaims,
  STAFF_SESSION_COOKIE,
} from './staff-auth';

/** How a route says which tournament the request is about. */
type TournamentResolver = (c: Context<Env>) => Promise<TournamentRow | null>;

/** For routes keyed by a `:tournamentId` path parameter. */
export const byTournamentIdParam: TournamentResolver = c =>
  fetchTournamentById(c.env, c.req.param('tournamentId') ?? '');

/** For the public routes keyed by `:regionSlug` / `:tournamentSlug`. */
export const byTournamentSlugParams: TournamentResolver = c =>
  fetchTournamentBySlug(
    c.env,
    c.req.param('regionSlug') ?? '',
    c.req.param('tournamentSlug') ?? '',
  );

/**
 * Lets anyone through while the tournament's entry period is open, and only
 * its own staff through once it has closed (or before it has opened).
 *
 * This is the requirement "エントリーフォームの URL は、エントリー期間中は
 * オープンアクセス、期間外は地域スタッフ及び統括スタッフのみアクセス可能"
 * (`requirements.md` §エントリーフォーム) enforced at the API rather than
 * only in the page that calls it: the closed period exists so staff can
 * check a form before it goes live, and a gate that only the SvelteKit
 * `load` applies is one a direct request to the Worker walks around.
 *
 * "Staff" is not enough on its own — a 地域スタッフ has no reason to read
 * another region's unpublished form — so the same region × tournament-type
 * scope the staff-only endpoints use decides it (`isInScope()`).
 *
 * The public entry list (`routes/entry-list.ts`) deliberately does not use
 * this: it is read after the entry period has closed, which is exactly when
 * this would refuse it.
 *
 * The resolved row is left on the context as `tournament`, so a handler
 * that needs it (the by-slug tournament read) doesn't query it twice, and
 * the claims as `entryPeriodStaff` on the path that needed them, so a
 * handler can tell a staff preview of an unpublished form from the public
 * in-period read. Both are optional: neither is set on every path here.
 *
 * @param resolveTournament How to find the tournament this request is
 *     about, e.g. `byTournamentIdParam`.
 */
export function requireOpenEntryPeriodOrStaff(
  resolveTournament: TournamentResolver,
) {
  return createMiddleware<Env>(async (c, next) => {
    let tournament: TournamentRow | null;
    try {
      tournament = await resolveTournament(c);
    } catch (e: unknown) {
      return c.json(tournamentLookupFailure(e), 500);
    }
    if (!tournament) {
      return c.json({error: 'tournament not found'}, 404);
    }
    c.set('tournament', tournament);

    if (
      isWithinEntryPeriod(tournament.entry_opens_at, tournament.entry_closes_at)
    ) {
      await next();
      return;
    }

    const cookie = getCookie(c, STAFF_SESSION_COOKIE);
    const staff = await readStaffClaims(cookie, c.env.SESSION_SECRET);
    // A cookie that no longer verifies is a session that died, not a caller
    // who never had one -- and the difference matters to the staff screens
    // behind this gate, which check their claims before fetching and can
    // only be caught out by a token that expires in between. They read this
    // 401 as "log in again"; a 403 would strand them on 「権限がありません」
    // with a working account.
    if (cookie && !staff) {
      return c.json({error: 'staff session expired'}, 401);
    }
    // Having no session at all is answered 403 rather than 401 instead: the
    // resource is not one a login would generally unlock, and the entry
    // form's own error mapping already renders this `error` string as
    // 「エントリー期間外です」.
    if (!staff) {
      return c.json({error: 'entry period closed'}, 403);
    }
    // The session is checked against `sessions_valid_from` before the scope,
    // the same order as the staff guards: a revoked session is a dead one,
    // answered the same as an expired cookie for the same reason, and it
    // stays dead whichever tournament it is aimed at. Checking scope first
    // would answer a revoked 地域スタッフ looking at another region's form
    // with a 403 that never sends them back to log in.
    const check = await isSessionCurrent(c.env, staff);
    if (!check.ok) {
      return c.json({error: 'internal server error'}, 500);
    }
    if (!check.current) {
      return c.json({error: 'staff session expired'}, 401);
    }
    if (!isInScope(staff, tournament)) {
      return c.json({error: 'entry period closed'}, 403);
    }
    c.set('entryPeriodStaff', staff);
    await next();
  });
}
