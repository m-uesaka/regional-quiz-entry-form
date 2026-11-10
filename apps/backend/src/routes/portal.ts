import {Hono} from 'hono';
import {
  isAcceptingEntries,
  PortalTournamentSchema,
  type PortalTournament,
} from '@regional-quiz/shared';
import type {Env} from '../types/env';
import {type Tables} from '../lib/db';
import {unwrap} from '../lib/errors';
import {tournamentDisplayName} from '../lib/tournaments';

/** A `tournaments` row with its region embedded, as selected below. */
interface PortalTournamentRow extends Pick<
  Tables<'tournaments'>,
  | 'type'
  | 'name'
  | 'entry_opens_at'
  | 'entry_closes_at'
  | 'entries_paused'
  | 'capacity'
> {
  regulations: Array<
    Pick<
      Tables<'regulations'>,
      | 'label'
      | 'priority_starts_at'
      | 'priority_ends_at'
      | 'closes_with_priority'
    >
  >;
  // `!inner` makes PostgREST drop a tournament without a region rather than
  // answer `null` here, but the type stays honest about the join.
  regions: Pick<
    Tables<'regions'>,
    'slug' | 'name' | 'allows_dual_entry'
  > | null;
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
    // Without a region the row fails the schema on `regionSlug` anyway.
    tournamentName:
      row.regions &&
      tournamentDisplayName(row.name, row.regions.name, row.type),
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
  const db = c.get('db');
  const data = unwrap(
    await db
      .from('tournaments')
      .select(
        `
        type, name, entry_opens_at, entry_closes_at, entries_paused,
        capacity,
        regions!inner(slug, name, allows_dual_entry),
        regulations(label, priority_starts_at, priority_ends_at,
        closes_with_priority)
      `,
      )
      // The order general staff set (`reorder_tournaments()`, 0032); `id`
      // only breaks a tie, which the column's sequence default never makes.
      .order('display_order', {ascending: true})
      .order('id', {ascending: true})
      .order('display_order', {
        referencedTable: 'regulations',
        ascending: true,
      }),
    'failed to read the tournaments',
  );
  const now = new Date();
  const tournaments = data
    .map(row => rowToPortalTournament(row, now))
    .filter(tournament => tournament !== null);
  return c.json(tournaments);
});
