import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import {readFileSync} from 'node:fs';
import {
  activePriorityRegulations,
  selectableRegulations,
} from '@regional-quiz/shared';
import {NO_LASTING_REGULATION_SQLSTATE} from './pg-errors';
import {DB_URL, isDbReachable} from '../test-support/db';

const MIGRATION_URL = new URL(
  '../../../../supabase/migrations/0059_drop_legacy_general_phase_windows.sql',
  import.meta.url,
);

// Unique per run, so a run stopped before its `afterAll` leaves nothing the
// next one collides with.
const REGION_SLUG = `regulations-backfill-test-${crypto.randomUUID()}`;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The statement 0059 clears the windows with, as it shipped. */
function pruneStatement(): string {
  const match = /-- prune:start\n([\s\S]+?)-- prune:end/.exec(
    readFileSync(MIGRATION_URL, 'utf8'),
  );
  if (!match) throw new Error('0059 has lost its prune markers');
  return match[1];
}

/** A regulation of the grid, as the shared rules read it. */
interface GridRegulation {
  id: string;
  priorityStartsAt: string | null;
  priorityEndsAt: string | null;
  closesWithPriority: boolean;
}

/**
 * Every tournament of three regulations that can be made from six instants
 * around `now` -- three days back to three days on, none within a day of it
 * -- each regulation having a window or none and, with a window, being
 * marked to close or not. The order of the regulations means nothing to the
 * rules, so each set appears once.
 * @param now The moment the windows are laid out around.
 */
function grid(now: number): GridRegulation[][] {
  const instants = [-3, -2, -1, 1, 2, 3].map(days =>
    new Date(now + days * DAY_MS).toISOString(),
  );
  const shapes: Array<Omit<GridRegulation, 'id'>> = [
    {priorityStartsAt: null, priorityEndsAt: null, closesWithPriority: false},
  ];
  instants.forEach((priorityStartsAt, i) => {
    for (const priorityEndsAt of instants.slice(i + 1)) {
      for (const closesWithPriority of [false, true]) {
        shapes.push({priorityStartsAt, priorityEndsAt, closesWithPriority});
      }
    }
  });
  const cases: GridRegulation[][] = [];
  shapes.forEach((a, i) => {
    shapes.slice(i).forEach((b, j) => {
      for (const c of shapes.slice(i + j)) {
        cases.push([a, b, c].map((shape, n) => ({id: `reg-${n}`, ...shape})));
      }
    });
  });
  return cases;
}

/**
 * Test-only: whether the rule #262 removed took a window for the opening of
 * the general phase -- not marked to close, and started once a marked window
 * had ended. Kept as the oracle for 0059, which has to clear the windows that
 * leaned on it. Don't import it from anything that ships.
 * @param regulation The regulation.
 * @param regulations Its tournament's regulations.
 */
function followsClosingPhase(
  regulation: GridRegulation,
  regulations: readonly GridRegulation[],
): boolean {
  const {priorityStartsAt, priorityEndsAt} = regulation;
  return (
    priorityStartsAt !== null &&
    priorityEndsAt !== null &&
    !regulation.closesWithPriority &&
    regulations.some(
      earlier =>
        earlier.closesWithPriority &&
        earlier.priorityStartsAt !== null &&
        earlier.priorityEndsAt !== null &&
        Date.parse(earlier.priorityEndsAt) <= Date.parse(priorityStartsAt),
    )
  );
}

/**
 * Test-only: what `activePriorityRegulations()` answered before #262. The
 * marked phases are over exactly when a marked regulation has gone from
 * `selectableRegulations()`, which #262 left alone.
 * @param regulations The tournament's regulations.
 * @param now The moment to check at.
 */
function activeIdsBefore262(
  regulations: readonly GridRegulation[],
  now: Date,
): string[] {
  const phasesOver =
    selectableRegulations(regulations, now).length < regulations.length;
  return activePriorityRegulations(regulations, now)
    .filter(
      regulation =>
        !(phasesOver && followsClosingPhase(regulation, regulations)),
    )
    .map(regulation => regulation.id);
}

/**
 * Every moment from `from` on at which a tournament's answers could change:
 * `from` itself and each later instant of its windows, a millisecond either
 * side.
 * @param regulations The tournament's regulations.
 * @param from The earliest moment that still matters.
 */
function turningPoints(
  regulations: readonly GridRegulation[],
  from: number,
): Date[] {
  const instants = regulations
    .flatMap(r => [r.priorityStartsAt, r.priorityEndsAt])
    .flatMap(instant => (instant === null ? [] : [Date.parse(instant)]));
  const moments = new Set([
    from,
    ...instants.flatMap(ms => [ms - 1, ms, ms + 1]).filter(ms => ms >= from),
  ]);
  return [...moments].sort((a, b) => a - b).map(ms => new Date(ms));
}

/** Thrown to roll a transaction back once a test has what it wanted. */
class RollBack extends Error {}

// Requires a running local Supabase instance (`supabase start`); skipped
// automatically when one isn't reachable; see `test-support/db.ts`.
describe.skipIf(!(await isDbReachable()))(
  'closes_with_priority (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);

    afterAll(async () => {
      await sql.close();
    });

    // Runs 0059's statement over the grid, one tournament per case, and
    // checks with the rules themselves that nothing from then on answers
    // differently. Everything is rolled back: `unique (region_id, type)`
    // means a region each, and the rows are of no use afterwards. The
    // statement also reaches whatever else the database holds, which the
    // rollback undoes as well.
    it('0059 clears only windows whose going changes no answer from then on', async () => {
      const cases = grid(Date.now());
      const rows = cases.flatMap((regulations, tournament) =>
        regulations.map(regulation => ({
          tournament,
          id: regulation.id,
          starts_at: regulation.priorityStartsAt,
          ends_at: regulation.priorityEndsAt,
          closes: regulation.closesWithPriority,
        })),
      );
      let appliedAt = 0;
      let stored: Array<{
        tournament: number;
        id: string;
        starts_at: Date | null;
        ends_at: Date | null;
        closes: boolean;
      }> = [];

      await sql
        .begin(async tx => {
          // A statement that goes wrong here must not outlive the test.
          await tx`set local statement_timeout = '60s'`;
          await tx`
            create temporary table prune_case on commit drop as
            select
              c.tournament,
              c.id,
              c.starts_at,
              c.ends_at,
              c.closes,
              gen_random_uuid() as region_id,
              gen_random_uuid() as tournament_id,
              gen_random_uuid() as regulation_id
            from jsonb_to_recordset(${rows}::jsonb) as c(
              tournament integer,
              id text,
              starts_at timestamptz,
              ends_at timestamptz,
              closes boolean
            )
          `;
          await tx`
            update prune_case c
            set region_id = first.region_id,
              tournament_id = first.tournament_id
            from (
              select distinct on (tournament)
                tournament, region_id, tournament_id
              from prune_case
              order by tournament
            ) first
            where first.tournament = c.tournament
          `;
          await tx`
            insert into regions (id, slug, name)
            select distinct region_id,
              ${REGION_SLUG} || '-' || tournament,
              ${REGION_SLUG} || '-' || tournament
            from prune_case
          `;
          await tx`
            insert into tournaments (
              id, region_id, type, name, entry_opens_at, entry_closes_at
            )
            select distinct tournament_id, region_id,
              'saikyoi'::tournament_type, '優先期間の整理',
              now() - interval '10 days', now() + interval '10 days'
            from prune_case
          `;
          await tx`
            insert into regulations (
              id, tournament_id, label, priority_starts_at, priority_ends_at,
              closes_with_priority
            )
            select regulation_id, tournament_id, id, starts_at, ends_at, closes
            from prune_case
          `;
          // The planner otherwise goes by the statistics from before these
          // rows, takes the table for nearly empty and joins by nested
          // loops, which over thousands of tournaments may not finish. A
          // deploy runs the statement on a table whose statistics are
          // current.
          await tx`analyze regulations`;

          // `now()` is the transaction's, so this is the statement's too.
          const [{applied_at: at}] = await tx`select now() as applied_at`;
          appliedAt = (at as Date).getTime();
          await tx.unsafe(pruneStatement());

          stored = await tx`
            select c.tournament, c.id,
              r.priority_starts_at as starts_at,
              r.priority_ends_at as ends_at,
              r.closes_with_priority as closes
            from regulations r
            join prune_case c on c.regulation_id = r.id
          `;
          throw new RollBack();
        })
        .catch((e: unknown) => {
          if (!(e instanceof RollBack)) throw e;
        });

      const after = cases.map(() => new Map<string, GridRegulation>());
      for (const row of stored) {
        after[row.tournament].set(row.id, {
          id: row.id,
          priorityStartsAt: row.starts_at?.toISOString() ?? null,
          priorityEndsAt: row.ends_at?.toISOString() ?? null,
          closesWithPriority: row.closes,
        });
      }
      let cleared = 0;
      let settled = 0;
      let leftToRestrict = 0;

      cases.forEach((before, tournament) => {
        const context = JSON.stringify({before, appliedAt});
        const pruned = before.map(regulation => {
          const row = after[tournament].get(regulation.id);
          if (!row) throw new Error(`0059 lost a regulation: ${context}`);
          return row;
        });

        // Only windows the removed rule exempted go, whole, and nothing
        // else about a regulation changes.
        before.forEach((regulation, n) => {
          const wasCleared =
            regulation.priorityStartsAt !== null &&
            pruned[n].priorityStartsAt === null;
          if (wasCleared) cleared++;
          expect([context, pruned[n]]).toEqual([
            context,
            wasCleared
              ? {...regulation, priorityStartsAt: null, priorityEndsAt: null}
              : regulation,
          ]);
          expect([
            context,
            wasCleared && !followsClosingPhase(regulation, before),
          ]).toEqual([context, false]);
        });

        // A window 0059 left that the removed rule would exempt is where the
        // new rules may answer differently: it now restricts as written.
        const isSettled = !pruned.some(regulation =>
          followsClosingPhase(regulation, pruned),
        );
        if (isSettled) {
          settled++;
        } else {
          leftToRestrict++;
        }

        for (const now of turningPoints(before, appliedAt)) {
          const at = [context, now.toISOString()];
          const selectable = selectableRegulations(before, now).map(r => r.id);
          const active = activeIdsBefore262(before, now);

          // The Worker from before #262 answers the same on the cleared
          // rows: the migration is out before the Worker is.
          expect([
            ...at,
            selectableRegulations(pruned, now).map(r => r.id),
            activeIdsBefore262(pruned, now),
          ]).toEqual([...at, selectable, active]);
          if (!isSettled) continue;
          // And so does the Worker without the rule.
          expect([
            ...at,
            activePriorityRegulations(pruned, now).map(r => r.id),
          ]).toEqual([...at, active]);
        }
      });

      expect(cleared).toBeGreaterThan(100);
      expect(settled).toBeGreaterThan(1000);
      expect(leftToRestrict).toBeGreaterThan(100);
    }, 120_000);

    describe('sync_regulations()', () => {
      let tournamentId: string;
      const WINDOW = {
        priorityStartsAt: '2026-11-05T00:00:00Z',
        priorityEndsAt: '2026-11-10T00:00:00Z',
      };

      const sync = (regulations: unknown[]) =>
        sql`select sync_regulations(${tournamentId}, ${regulations}::jsonb)`;
      const stored = async (): Promise<
        Array<{id: string; label: string; closes_with_priority: boolean}>
      > => sql`
        select id, label, closes_with_priority from regulations
        where tournament_id = ${tournamentId}
        order by display_order
      `;
      // Saves `regulations` followed by a general regulation that never
      // closes, kept by id, since a set that all closes is refused (P0009).
      const save = async (regulations: unknown[]) => {
        const general = (await stored()).find(r => r.label === '一般');
        return sync([
          ...regulations,
          general ? {id: general.id, label: '一般'} : {label: '一般'},
        ]);
      };

      beforeAll(async () => {
        const [region] = await sql`
          insert into regions (slug, name)
          values (${REGION_SLUG}, ${REGION_SLUG})
          returning id
        `;
        const [tournament] = await sql`
          insert into tournaments (
            region_id, type, name, entry_opens_at, entry_closes_at
          ) values (
            ${region.id}, 'saikyoi', '同期', '2026-11-01', '2026-12-25'
          )
          returning id
        `;
        tournamentId = tournament.id;
      });

      afterAll(async () => {
        await sql`delete from tournaments where id = ${tournamentId}`;
        await sql`delete from regions where slug = ${REGION_SLUG}`;
      });

      it('starts a new regulation at false', async () => {
        await save([{label: '優先', ...WINDOW}]);

        expect((await stored())[0].closes_with_priority).toBe(false);
      });

      it('writes the value it is given', async () => {
        const [{id}] = await stored();

        await save([{id, label: '優先', ...WINDOW, closesWithPriority: true}]);
        expect((await stored())[0].closes_with_priority).toBe(true);

        await save([{id, label: '優先', ...WINDOW, closesWithPriority: false}]);
        expect((await stored())[0].closes_with_priority).toBe(false);
      });

      // An old Worker, a form rendered before the box, a blank sheet cell.
      it('keeps the stored value when the key is absent', async () => {
        const [{id}] = await stored();
        await sql`
          update regulations set closes_with_priority = true where id = ${id}
        `;

        await save([{id, label: '優先', ...WINDOW}]);

        expect((await stored())[0].closes_with_priority).toBe(true);
      });

      // What a re-import of an older sheet does: 0036 pairs by label and
      // passes the rest through, under the signature old Workers call.
      it('keeps it through import_tournament()', async () => {
        const [{id}] = await stored();
        await sql`
          update regulations set closes_with_priority = true where id = ${id}
        `;
        const [{region_id: regionId}] = await sql`
          select region_id from tournaments where id = ${tournamentId}
        `;
        const regulations = [{label: '優先', ...WINDOW}, {label: '一般'}];

        await sql`
          select * from import_tournament(
            ${regionId}, 'saikyoi'::tournament_type, true, null,
            '2026-11-01', '2026-12-25', '[]'::jsonb, ${regulations}::jsonb
          )
        `;

        expect(
          (await stored()).map(r => [r.label, r.closes_with_priority]),
        ).toEqual([
          ['優先', true],
          ['一般', false],
        ]);
      });

      it('refuses a set that all closes', async () => {
        const [{id}] = await stored();

        await expect(
          sync([{id, label: '優先', ...WINDOW, closesWithPriority: true}]),
        ).rejects.toMatchObject({errno: NO_LASTING_REGULATION_SQLSTATE});
      });

      // The schema only sees what is sent; an omitted key keeps a stored
      // true, so the function checks the saved values.
      it('refuses a set that all closes through kept values', async () => {
        const [{id}] = await stored();
        await sql`
          update regulations set closes_with_priority = true where id = ${id}
        `;

        await expect(
          sync([{id, label: '優先', ...WINDOW}]),
        ).rejects.toMatchObject({
          errno: NO_LASTING_REGULATION_SQLSTATE,
        });
        expect((await stored()).map(r => r.label)).toEqual(['優先', '一般']);
      });

      it('clears the value along with the window', async () => {
        const [{id}] = await stored();
        await sql`
          update regulations set closes_with_priority = true where id = ${id}
        `;

        await save([{id, label: '優先'}]);

        expect((await stored())[0].closes_with_priority).toBe(false);
      });
    });
  },
);
