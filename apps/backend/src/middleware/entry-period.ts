import type {Context} from 'hono';
import {createMiddleware} from 'hono/factory';
import {getCookie} from 'hono/cookie';
import {isWithinEntryPeriod} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {internalError} from '../lib/errors';
import {
  fetchTournamentById,
  fetchTournamentBySlug,
  TournamentLookupError,
  type TournamentRow,
} from '../lib/tournaments';
import {isInScope, readStaffClaims, STAFF_SESSION_COOKIE} from './staff-auth';

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
      const cause = e instanceof TournamentLookupError ? e.cause : e;
      return c.json(internalError('failed to read the tournament', cause), 500);
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
    if (!staff || !isInScope(staff, tournament)) {
      return c.json({error: 'entry period closed'}, 403);
    }
    c.set('entryPeriodStaff', staff);
    await next();
  });
}
