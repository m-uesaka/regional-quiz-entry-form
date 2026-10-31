import {Hono} from 'hono';
import {
  defaultTournamentName,
  isAcceptingEntries,
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
  name: string | null;
  entry_opens_at: string;
  entry_closes_at: string;
  entries_paused: boolean;
  capacity: number | null;
  regulations: Array<{
    label: string;
    priority_starts_at: string | null;
    priority_ends_at: string | null;
    closes_with_priority: boolean;
  }>;
  // `!inner` makes PostgREST drop a tournament without a region rather than
  // answer `null` here, but the type stays honest about the join.
  regions: {slug: string; name: string; allows_dual_entry: boolean} | null;
}

/**
 * Turns a row into what the portal answers with, or `null` when the row
 * doesn't fit the schema. One unreadable tournament is logged and left out
 * rather than thrown: a throw here would take every other region's form
 * off the portal with it.
 */
function rowToPortalTournament(
  row: PortalTournamentRow,
  now: Date,
): PortalTournament | null {
  // Only an open form's regulations are public (see `PortalTournamentSchema`).
  const regulations = isAcceptingEntries(
    {
      entryOpensAt: row.entry_opens_at,
      entryClosesAt: row.entry_closes_at,
      entriesPaused: row.entries_paused,
    },
    now,
  )
    ? row.regulations
    : [];
  const result = PortalTournamentSchema.safeParse({
    regionSlug: row.regions?.slug,
    regionName: row.regions?.name,
    regionAllowsDualEntry: row.regions?.allows_dual_entry,
    tournamentType: row.type,
    // Blank-named tournaments are named after their region on read (0024).
    tournamentName:
      row.name ??
      (row.regions && defaultTournamentName(row.regions.name, row.type)),
    entryOpensAt: row.entry_opens_at,
    entryClosesAt: row.entry_closes_at,
    entriesPaused: row.entries_paused,
    capacity: row.capacity,
    priorityRegulations: regulations.flatMap(regulation =>
      regulation.priority_starts_at !== null &&
      regulation.priority_ends_at !== null
        ? [
            {
              label: regulation.label,
              priorityStartsAt: regulation.priority_starts_at,
              priorityEndsAt: regulation.priority_ends_at,
              closesWithPriority: regulation.closes_with_priority,
            },
          ]
        : [],
    ),
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

// Public on purpose, and not behind the entry-period gate
// (`middleware/entry-period.ts`): the portal is where participants find the
// forms, and listing the closed ones too is what lets it say when a form
// opens. It answers only names, slugs, whether a region allows entering both
// of its tournaments, the entry period, the capacity and --
// for a form that is open, and so already shows them -- the regulations'
// priority windows; whether a closed form can be opened is still decided by
// that gate on the form's own routes.
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
      'type, name, entry_opens_at, entry_closes_at, entries_paused, ' +
        'capacity, ' +
        'regions!inner(slug, name, allows_dual_entry), ' +
        'regulations(label, priority_starts_at, priority_ends_at, ' +
        'closes_with_priority)',
    )
    // The order general staff set (`reorder_tournaments()`, 0032); `id`
    // only breaks a tie, which the column's sequence default never makes.
    .order('display_order', {ascending: true})
    .order('id', {ascending: true})
    .order('display_order', {referencedTable: 'regulations', ascending: true})
    .returns<PortalTournamentRow[]>();
  if (error) {
    return c.json(internalError('failed to read the tournaments', error), 500);
  }
  const now = new Date();
  const tournaments = data
    .map(row => rowToPortalTournament(row, now))
    .filter(tournament => tournament !== null);
  return c.json(tournaments);
});
