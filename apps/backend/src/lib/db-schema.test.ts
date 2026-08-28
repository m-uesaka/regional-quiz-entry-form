import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';

// Local Supabase Postgres connection (`supabase start` default). Overridable
// via SUPABASE_DB_URL for other local setups.
const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function isDbReachable(): Promise<boolean> {
  const probe = new SQL(DB_URL);
  try {
    await probe`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.close();
  }
}

// Requires a running local Supabase instance (`supabase start`); skipped
// automatically when one isn't reachable, e.g. in CI.
describe.skipIf(!(await isDbReachable()))(
  'entries table (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testEmail = 'db-schema-test@example.com';
    const testRegionSlug = 'db-schema-test-region';

    afterAll(async () => {
      await sql`delete from entries where participant_id in (
        select id from participants where email = ${testEmail}
      )`;
      await sql`delete from participants where email = ${testEmail}`;
      await sql`delete from regulations where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug = ${testRegionSlug}
        )
      )`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug = ${testRegionSlug}
      )`;
      await sql`delete from regions where slug = ${testRegionSlug}`;
      await sql.close();
    });

    it('enforces unique participant/tournament pair', async () => {
      const [region] = await sql`
        insert into regions (slug, name) values (${testRegionSlug}, 'テスト地域')
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at
        ) values (
          ${region.id}, 'saikyoi', 'テスト大会', now(), now()
        )
        returning id
      `;
      const [regulation] = await sql`
        insert into regulations (tournament_id, label)
        values (${tournament.id}, 'テストレギュレーション')
        returning id
      `;
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (${region.id}, ${testEmail}, 'hash')
        returning id
      `;
      const entryInput = {
        participant_id: participant.id,
        tournament_id: tournament.id,
        name: '山田太郎',
        furigana: 'ヤマダタロウ',
        display_name: '太郎',
        regulation_id: regulation.id,
      };

      await sql`insert into entries ${sql(entryInput)}`;

      let duplicateInsertThrew = false;
      try {
        await sql`insert into entries ${sql(entryInput)}`;
      } catch {
        duplicateInsertThrew = true;
      }
      expect(duplicateInsertThrew).toBe(true);
    });
  },
);

// Also requires a running local Supabase instance: `tournament_entry_summary()`
// is pure SQL living in `supabase/migrations/`, so the aggregation it does
// for the general-staff dashboard can only be checked against a real
// Postgres.
describe.skipIf(!(await isDbReachable()))(
  'tournament_entry_summary() (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const summaryEmailPrefix = 'summary-test-';
    const summaryRegionSlugPrefix = 'summary-test-region-';
    const summaryRegionSlugs = [
      `${summaryRegionSlugPrefix}a`,
      `${summaryRegionSlugPrefix}b`,
    ];

    afterAll(async () => {
      await sql`delete from entries where participant_id in (
        select id from participants where email like ${summaryEmailPrefix + '%'}
      )`;
      await sql`delete from participants where email like ${summaryEmailPrefix + '%'}`;
      await sql`delete from regulations where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${summaryRegionSlugPrefix + '%'}
        )
      )`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug like ${summaryRegionSlugPrefix + '%'}
      )`;
      await sql`delete from regions where slug like ${summaryRegionSlugPrefix + '%'}`;
      await sql.close();
    });

    /** Inserts a region with one `saikyoi` tournament and its regulation. */
    async function seedTournament(
      slug: string,
      regionName: string,
      capacity: number | null,
    ): Promise<{regionId: string; tournamentId: string; regulationId: string}> {
      const [region] = await sql`
        insert into regions (slug, name) values (${slug}, ${regionName})
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, capacity, entry_opens_at, entry_closes_at
        ) values (
          ${region.id}, 'saikyoi', ${regionName + '大会'}, ${capacity},
          now(), now()
        )
        returning id
      `;
      const [regulation] = await sql`
        insert into regulations (tournament_id, label)
        values (${tournament.id}, '一般の部')
        returning id
      `;
      return {
        regionId: region.id,
        tournamentId: tournament.id,
        regulationId: regulation.id,
      };
    }

    async function seedEntry(
      tournament: {
        tournamentId: string;
        regionId: string;
        regulationId: string;
      },
      email: string,
      status: string,
    ): Promise<void> {
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (${tournament.regionId}, ${email}, 'hash')
        returning id
      `;
      await sql`insert into entries ${sql({
        participant_id: participant.id,
        tournament_id: tournament.tournamentId,
        name: '山田太郎',
        furigana: 'ヤマダタロウ',
        display_name: '太郎',
        regulation_id: tournament.regulationId,
        status,
      })}`;
    }

    it('counts entries per status across regions, keeping empty tournaments', async () => {
      // `regionName` doubles as the sort key: the function orders by region
      // name, so these two are asserted in this order below.
      const regionA = await seedTournament(
        summaryRegionSlugs[0],
        'AAA集計テスト地域',
        2,
      );
      const regionB = await seedTournament(
        summaryRegionSlugs[1],
        'BBB集計テスト地域',
        null,
      );
      await seedEntry(
        regionA,
        `${summaryEmailPrefix}1@example.com`,
        'confirmed',
      );
      await seedEntry(
        regionA,
        `${summaryEmailPrefix}2@example.com`,
        'confirmed',
      );
      await seedEntry(
        regionA,
        `${summaryEmailPrefix}3@example.com`,
        'waitlisted',
      );
      await seedEntry(
        regionA,
        `${summaryEmailPrefix}4@example.com`,
        'cancelled',
      );

      const rows: Array<Record<string, unknown>> =
        await sql`select * from tournament_entry_summary()
                  where region_slug like ${summaryRegionSlugPrefix + '%'}`;

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        tournament_id: regionA.tournamentId,
        region_slug: summaryRegionSlugs[0],
        tournament_type: 'saikyoi',
        capacity: 2,
        confirmed_count: 2,
        waitlisted_count: 1,
        pending_verification_count: 0,
        cancelled_count: 1,
      });
      // A tournament nobody entered still reports a row, with zeros.
      expect(rows[1]).toMatchObject({
        tournament_id: regionB.tournamentId,
        region_slug: summaryRegionSlugs[1],
        capacity: null,
        confirmed_count: 0,
        waitlisted_count: 0,
      });
    });
  },
);

// The half-open priority window is ruled out in the Zod schema as well, but
// setting regulations straight through SQL stays a supported operation, so
// the constraint has to hold on its own.
describe.skipIf(!(await isDbReachable()))(
  'regulations table (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'db-schema-regulations-test-region';

    async function deleteTestRegion(): Promise<void> {
      await sql`delete from regulations where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug = ${testRegionSlug}
        )
      )`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug = ${testRegionSlug}
      )`;
      await sql`delete from regions where slug = ${testRegionSlug}`;
    }

    beforeAll(deleteTestRegion);

    afterAll(async () => {
      await deleteTestRegion();
      await sql.close();
    });

    async function createTournament(): Promise<string> {
      const [region] = await sql`
        insert into regions (slug, name) values (${testRegionSlug}, 'テスト地域')
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at
        ) values (
          ${region.id}, 'saikyoi', 'テスト大会', now(), now()
        )
        returning id
      `;
      return tournament.id as string;
    }

    it('rejects a half-open priority window', async () => {
      const tournamentId = await createTournament();

      let halfOpenInsertThrew = false;
      try {
        await sql`
          insert into regulations (tournament_id, label, priority_starts_at)
          values (${tournamentId}, '半開の部', now())
        `;
      } catch {
        halfOpenInsertThrew = true;
      }
      expect(halfOpenInsertThrew).toBe(true);

      // A window that ends before it starts is rejected by the same
      // constraint.
      let backwardsInsertThrew = false;
      try {
        await sql`
          insert into regulations (
            tournament_id, label, priority_starts_at, priority_ends_at
          ) values (
            ${tournamentId}, '逆順の部', now(), now() - interval '1 day'
          )
        `;
      } catch {
        backwardsInsertThrew = true;
      }
      expect(backwardsInsertThrew).toBe(true);

      // Both endpoints null, and a well-formed window, still go in.
      await sql`
        insert into regulations (tournament_id, label) values (${tournamentId}, '通常の部')
      `;
      await sql`
        insert into regulations (
          tournament_id, label, priority_starts_at, priority_ends_at
        ) values (
          ${tournamentId}, '優先の部', now(), now() + interval '1 day'
        )
      `;
      const rows = await sql`
        select label from regulations where tournament_id = ${tournamentId}
      `;
      expect(rows).toHaveLength(2);
    });
  },
);
