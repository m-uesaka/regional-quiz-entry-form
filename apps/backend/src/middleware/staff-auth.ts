import type {Context} from 'hono';
import {createMiddleware} from 'hono/factory';
import {getCookie} from 'hono/cookie';
import {verify} from 'hono/jwt';
import {
  canPreviewTournament,
  StaffClaimsSchema,
  type StaffClaims,
  type TournamentType,
} from '@regional-quiz/shared';
import type {Bindings, StaffEnv} from '../types/env';
import {createDbClient} from '../lib/db';
import {fetchTournamentById, type TournamentRow} from '../lib/tournaments';

export const STAFF_SESSION_COOKIE = 'staff_session';

export interface TournamentScopeRow {
  region_id: string;
  type: TournamentType;
}

/**
 * Verifies and parses the `staff_session` cookie.
 *
 * This checks the signature, `exp` and the claims' shape only. Whether the
 * session has since been revoked is `isSessionCurrent()`'s question, which
 * costs a database read and so is asked separately.
 *
 * Exported for `middleware/entry-period.ts`, which needs the claims of a
 * caller it does *not* require to be staff at all: outside a tournament's
 * entry period a staff session decides the answer, inside it the same
 * request is served to anyone.
 * @param token The raw cookie value, if the request carried one.
 * @param secret `SESSION_SECRET`, the key the token was signed with.
 * @return The claims, or `null` if the token is missing, invalid, expired,
 *     or doesn't match the expected shape -- including a token issued before
 *     `sessionsValidFrom` existed, which therefore reads as logged out.
 */
export async function readStaffClaims(
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

interface StaffSessionRow {
  sessions_valid_from: string;
}

/** What `isSessionCurrent()` found out, or that it couldn't find out. */
export type SessionCheck = {ok: true; current: boolean} | {ok: false};

/**
 * Whether `staff` is still a live session of its account.
 *
 * A signature can't tell whether the session was cut short after it was
 * issued: the JWT is stateless and lives for 12 hours, so a revocation
 * (`POST /api/staff/accounts/:id/revoke-sessions`) only shows up in
 * `staff_accounts.sessions_valid_from`. Without this read, a staff cookie
 * copied off a lost laptop would keep reaching every participant's name and
 * address until it expired, with nothing anyone could do about it.
 *
 * Mirrors the participant side (`middleware/participant-auth.ts`): the
 * session is current exactly when it names the generation that is on the
 * row now -- an equality between two readings of the same column, rather
 * than an "issued before?" comparison that would need the Worker's clock to
 * agree with Postgres'. An unparseable timestamp yields `NaN`, which
 * compares unequal to everything and so fails closed.
 *
 * Exported for `middleware/entry-period.ts`, which reads staff claims
 * without requiring a session and so can't use the guards below.
 * @param env The bindings to reach Supabase with.
 * @param staff The claims of a token whose signature already verified.
 * @return `ok: false` if the row couldn't be read. Callers answer that with
 *     a 500 rather than a 401: the session may well be fine, and
 *     "unauthorized" would send staff to log in again over a database
 *     outage.
 */
export async function isSessionCurrent(
  env: Bindings,
  staff: StaffClaims,
): Promise<SessionCheck> {
  const {data, error} = await createDbClient(env)
    .from('staff_accounts')
    .select('sessions_valid_from')
    .eq('id', staff.sub)
    .returns<StaffSessionRow[]>()
    .maybeSingle();
  if (error) {
    console.error('failed to check the session against the staff account', {
      error: error.message,
    });
    return {ok: false};
  }
  // A missing row means the account was deleted after the cookie was issued,
  // which is as much a dead session as a revoked one.
  return {
    ok: true,
    current:
      data !== null &&
      Date.parse(data.sessions_valid_from) === staff.sessionsValidFrom,
  };
}

/**
 * What a guard decides about a session once its signature has verified,
 * apart from whether it is still current: let it through, refuse it as out
 * of scope, or give up because the scope couldn't be read.
 */
type Authorization = 'allowed' | 'forbidden' | 'error';

/**
 * The verified, still-current claims of the caller's staff session, or the
 * response to refuse the request with.
 *
 * Shared by the guards below so that none of them can forget the revocation
 * check: a guard that verified only the signature would be the one door a
 * revoked cookie still opens.
 *
 * The revocation read and `authorize` run concurrently, since neither needs
 * the other's answer, but the revocation decides first: a dead session is
 * 401 whatever its scope, so the staff screens send its holder to log in
 * again rather than stranding them on 「権限がありません」.
 * @param c The request's context.
 * @param authorize What the guard requires of the session on top of being
 *     current, e.g. its role or that a tournament is in its scope.
 * @return The claims, or a 401 (no session, or a dead one), 403 (out of
 *     scope) or 500 (something couldn't be read).
 */
async function authenticateStaff(
  c: Context<StaffEnv>,
  authorize: (
    staff: StaffClaims,
  ) => Authorization | Promise<Authorization> = () => 'allowed',
): Promise<StaffClaims | Response> {
  const staff = await readStaffClaims(
    getCookie(c, STAFF_SESSION_COOKIE),
    c.env.SESSION_SECRET,
  );
  if (!staff) {
    return c.json({error: 'unauthorized'}, 401);
  }
  const [check, authorization] = await Promise.all([
    isSessionCurrent(c.env, staff),
    authorize(staff),
  ]);
  if (!check.ok) {
    return c.json({error: 'internal server error'}, 500);
  }
  if (!check.current) {
    return c.json({error: 'unauthorized'}, 401);
  }
  if (authorization === 'error') {
    return c.json({error: 'internal server error'}, 500);
  }
  if (authorization === 'forbidden') {
    return c.json({error: 'forbidden'}, 403);
  }
  return staff;
}

export function requireGeneralStaff() {
  return createMiddleware<StaffEnv>(async (c, next) => {
    const staff = await authenticateStaff(c, staff =>
      staff.role === 'general' ? 'allowed' : 'forbidden',
    );
    if (staff instanceof Response) return staff;
    c.set('staff', staff);
    await next();
  });
}

/**
 * Whether `staff`'s region/tournament-type claims cover `tournament`.
 *
 * The rule itself lives in `@regional-quiz/shared` so the frontend decides
 * the same way (`canPreviewTournament()`); this wrapper only translates the
 * snake_case row Supabase hands back and answers `false` for a tournament
 * that doesn't exist — which is not the same question, but is the same
 * refusal, and keeps a caller from having to check for it separately.
 * @param staff The caller's session claims.
 * @param tournament The tournament being asked for, or `null` if there is
 *     no such row.
 */
export function isInScope(
  staff: StaffClaims,
  tournament: TournamentScopeRow | null,
): boolean {
  return (
    tournament !== null &&
    canPreviewTournament(staff, {
      regionId: tournament.region_id,
      type: tournament.type,
    })
  );
}

/**
 * Lets through staff whose scope covers the `:tournamentId` in the path.
 *
 * The row read for the scope check is left on the context as `tournament`,
 * so a handler that needs the tournament doesn't fetch it a second time --
 * and can't see a different version of it than the one the check passed
 * (#123). General staff skip the check and so never read the row: there
 * `tournament` is unset, and a handler has to read it itself.
 */
export function requireStaffForTournament() {
  return createMiddleware<StaffEnv>(async (c, next) => {
    let tournament: TournamentRow | null = null;
    const staff = await authenticateStaff(c, async staff => {
      if (staff.role === 'general') return 'allowed';
      try {
        tournament = await fetchTournamentById(
          c.env,
          c.req.param('tournamentId') ?? '',
        );
      } catch {
        return 'error';
      }
      return isInScope(staff, tournament) ? 'allowed' : 'forbidden';
    });
    if (staff instanceof Response) return staff;
    c.set('staff', staff);
    if (tournament) {
      c.set('tournament', tournament);
    }
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
    const staff = await authenticateStaff(c, async staff => {
      if (staff.role === 'general') return 'allowed';
      const {data: entry, error} = await createDbClient(c.env)
        .from('entries')
        .select('tournaments(region_id, type)')
        .eq('id', c.req.param('entryId'))
        .returns<EntryScopeRow[]>()
        .maybeSingle();
      if (error) return 'error';
      return isInScope(staff, entry?.tournaments ?? null)
        ? 'allowed'
        : 'forbidden';
    });
    if (staff instanceof Response) return staff;
    c.set('staff', staff);
    await next();
  });
}
