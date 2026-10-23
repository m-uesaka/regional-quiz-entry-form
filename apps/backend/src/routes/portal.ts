import {Hono} from 'hono';
import {
  PortalTournamentSchema,
  type PortalTournament,
  type TournamentType,
} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {createDbClient} from '../lib/db';
import {internalError} from '../lib/errors';

/** A `tournaments` row with its region embedded, as selected below. */
interface PortalTournamentRow {
  type: TournamentType;
  name: string;
  entry_opens_at: string;
  entry_closes_at: string;
  // `!inner` makes PostgREST drop a tournament without a region rather than
  // answer `null` here, but the type stays honest about the join.
  regions: {slug: string; name: string} | null;
}

// The order the two tournaments of one region are listed in, matching how
// the event itself is named (最強位・新人王).
const TOURNAMENT_TYPE_ORDER: Record<TournamentType, number> = {
  saikyoi: 0,
  shinjinou: 1,
};

/**
 * Turns a row into what the portal answers with, or `null` when the row
 * doesn't fit the schema. One unreadable tournament is logged and left out
 * rather than thrown: a throw here would take every other region's form
 * off the portal with it.
 */
function rowToPortalTournament(
  row: PortalTournamentRow,
): PortalTournament | null {
  const result = PortalTournamentSchema.safeParse({
    regionSlug: row.regions?.slug,
    regionName: row.regions?.name,
    tournamentType: row.type,
    tournamentName: row.name,
    entryOpensAt: row.entry_opens_at,
    entryClosesAt: row.entry_closes_at,
  });
  if (!result.success) {
    console.error(
      'leaving an unreadable tournament off the portal',
      result.error.issues,
    );
    return null;
  }
  return result.data;
}

/**
 * Orders the portal by region name in Japanese collation (roughly by
 * reading, e.g. 東京 before 北海道), then 最強位 before 新人王 within a
 * region, so the page can group consecutive rows by region.
 */
function comparePortalTournaments(
  a: PortalTournament,
  b: PortalTournament,
): number {
  return (
    a.regionName.localeCompare(b.regionName, 'ja') ||
    a.regionSlug.localeCompare(b.regionSlug) ||
    TOURNAMENT_TYPE_ORDER[a.tournamentType] -
      TOURNAMENT_TYPE_ORDER[b.tournamentType]
  );
}

// Public on purpose, and not behind the entry-period gate
// (`middleware/entry-period.ts`): the portal is where participants find the
// forms, and listing the closed ones too is what lets it say when a form
// opens. It answers only names, slugs and the entry period; whether a closed
// form can be opened is still decided by that gate on the form's own routes.
//
// That includes tournaments whose entry period hasn't started, which the
// gate treats as unpublished: their name and dates are public here, as
// 受付開始前, even while the form itself is staff-only. This was decided
// deliberately (2026-10-23) so participants can see when a form opens; it
// means a tournament should only be created once its name and entry period
// are fit to announce.
export const portalRoute = new Hono<Env>().get('/tournaments', async c => {
  const db = createDbClient(c.env);
  const {data, error} = await db
    .from('tournaments')
    .select(
      'type, name, entry_opens_at, entry_closes_at, regions!inner(slug, name)',
    )
    .returns<PortalTournamentRow[]>();
  if (error) {
    return c.json(internalError('failed to read the tournaments', error), 500);
  }
  const tournaments = data
    .map(rowToPortalTournament)
    .filter(tournament => tournament !== null)
    .sort(comparePortalTournaments);
  return c.json(tournaments);
});
