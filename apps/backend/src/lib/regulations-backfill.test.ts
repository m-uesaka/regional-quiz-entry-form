import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import {readFileSync} from 'node:fs';
import {
  legacyDroppedIds,
  legacyGrid,
} from '@regional-quiz/shared/testing/legacy-general-phase';
import {DB_URL, isDbReachable} from '../test-support/db';

const MIGRATION_URL = new URL(
  '../../../../supabase/migrations/0042_regulations_closes_with_priority.sql',
  import.meta.url,
);

const REGION_SLUG = 'regulations-backfill-test-region';

/** The statement 0042 fills the column with, as it shipped. */
function backfillStatement(): string {
  const match = /-- backfill:start\n([\s\S]+?)-- backfill:end/.exec(
    readFileSync(MIGRATION_URL, 'utf8'),
  );
  if (!match) throw new Error('0042 has lost its backfill markers');
  return match[1];
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

    // Runs the statement over the old inference's whole grid, one tournament
    // per case, and compares it with what the inference itself dropped
    // (`legacyDroppedIds()`). Everything is rolled back: `unique (region_id,
    // type)` means a region each, and the rows are of no use afterwards.
    it('marks exactly the regulations the inference took off the choices', async () => {
      const grid = legacyGrid();
      const rows = grid.flatMap(({regulations, entryPeriod}, tournament) =>
        regulations.map(regulation => ({
          tournament,
          id: regulation.id,
          starts_at: regulation.priorityStartsAt,
          ends_at: regulation.priorityEndsAt,
          opens_at: entryPeriod.entryOpensAt,
          closes_at: entryPeriod.entryClosesAt,
        })),
      );
      let marked: Array<{tournament: number; id: string}> = [];

      await sql
        .begin(async tx => {
          await tx`
            create temporary table backfill_case on commit drop as
            select
              c.tournament,
              c.id,
              c.starts_at,
              c.ends_at,
              c.opens_at,
              c.closes_at,
              gen_random_uuid() as region_id,
              gen_random_uuid() as tournament_id,
              gen_random_uuid() as regulation_id
            from jsonb_to_recordset(${rows}::jsonb) as c(
              tournament integer,
              id text,
              starts_at timestamptz,
              ends_at timestamptz,
              opens_at timestamptz,
              closes_at timestamptz
            )
          `;
          await tx`
            update backfill_case c
            set region_id = first.region_id,
              tournament_id = first.tournament_id
            from (
              select distinct on (tournament)
                tournament, region_id, tournament_id
              from backfill_case
              order by tournament
            ) first
            where first.tournament = c.tournament
          `;
          await tx`
            insert into regions (id, slug, name)
            select distinct region_id,
              ${REGION_SLUG} || '-' || tournament,
              ${REGION_SLUG} || '-' || tournament
            from backfill_case
          `;
          await tx`
            insert into tournaments (
              id, region_id, type, name, entry_opens_at, entry_closes_at
            )
            select distinct tournament_id, region_id,
              'saikyoi'::tournament_type, 'バックフィル', opens_at, closes_at
            from backfill_case
          `;
          await tx`
            insert into regulations (
              id, tournament_id, label, priority_starts_at, priority_ends_at
            )
            select regulation_id, tournament_id, id, starts_at, ends_at
            from backfill_case
          `;

          await tx.unsafe(backfillStatement());

          marked = await tx`
            select c.tournament, c.id
            from regulations r
            join backfill_case c on c.regulation_id = r.id
            where r.closes_with_priority
          `;
          throw new RollBack();
        })
        .catch((e: unknown) => {
          if (!(e instanceof RollBack)) throw e;
        });

      const actual = marked.map(row => `${row.tournament}/${row.id}`).sort();
      const expected = grid
        .flatMap(({regulations, entryPeriod}, tournament) =>
          [...legacyDroppedIds(regulations, entryPeriod)].map(
            id => `${tournament}/${id}`,
          ),
        )
        .sort();
      expect(expected.length).toBeGreaterThan(100);
      expect(actual).toEqual(expected);
    }, 120_000);

    describe('sync_regulations()', () => {
      let tournamentId: string;
      const WINDOW = {
        priorityStartsAt: '2026-11-05T00:00:00Z',
        priorityEndsAt: '2026-11-10T00:00:00Z',
      };

      const save = (regulations: unknown[]) =>
        sql`select sync_regulations(${tournamentId}, ${regulations}::jsonb)`;
      const stored = async (): Promise<
        Array<{id: string; label: string; closes_with_priority: boolean}>
      > => sql`
        select id, label, closes_with_priority from regulations
        where tournament_id = ${tournamentId}
        order by display_order
      `;

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
