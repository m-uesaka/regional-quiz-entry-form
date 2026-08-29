import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'bun:test';
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

// The default is what the dual-entry rule in `lib/entries.ts` falls back to
// for every region that predates the column, so it is pinned down here
// rather than left to the migration being read correctly.
describe.skipIf(!(await isDbReachable()))(
  'regions table (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'db-schema-regions-test-region';

    // Also cleaned up on the way in, so a run interrupted before `afterAll`
    // doesn't leave a row that makes the next run fail on the unique slug.
    beforeAll(async () => {
      await sql`delete from regions where slug = ${testRegionSlug}`;
    });

    afterAll(async () => {
      await sql`delete from regions where slug = ${testRegionSlug}`;
      await sql.close();
    });

    it('defaults allows_dual_entry to false', async () => {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${testRegionSlug}, 'テスト地域')
        returning allows_dual_entry
      `;

      expect(region.allows_dual_entry).toBe(false);
    });
  },
);

// The DB-level backstop for `regions.allows_dual_entry` (migration 0017).
// `createEntry()` checks the rule before inserting, so what is exercised here
// is the window that check leaves open: an insert that arrives as if a
// concurrent submission had already taken the region's other seat.
describe.skipIf(!(await isDbReachable()))(
  'check_region_dual_entry() (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testEmail = 'db-schema-dual-entry-test@example.com';
    const testRegionSlug = 'db-schema-dual-entry-test-region';

    /**
     * Creates a region with both of its tournaments and a participant in
     * it, and returns a builder for the columns of that participant's entry
     * into either tournament.
     * @param allowsDualEntry The region's dual-entry setting.
     */
    async function seedRegion(allowsDualEntry: boolean) {
      const [region] = await sql`
        insert into regions (slug, name, allows_dual_entry)
        values (${testRegionSlug}, 'テスト地域', ${allowsDualEntry})
        returning id
      `;
      const seedTournament = async (type: string) => {
        const [tournament] = await sql`
          insert into tournaments (
            region_id, type, name, entry_opens_at, entry_closes_at
          ) values (
            ${region.id}, ${type}, ${'テスト' + type}, now(), now()
          )
          returning id
        `;
        return {tournament_id: tournament.id as string};
      };
      const tournaments = {
        saikyoi: await seedTournament('saikyoi'),
        shinjinou: await seedTournament('shinjinou'),
      };
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (${region.id}, ${testEmail}, 'hash')
        returning id
      `;
      const participantId = participant.id as string;

      /**
       * The insertable columns of an entry into one of the two tournaments.
       * @param type Which of the region's tournaments to enter.
       * @param status The status to insert the entry with.
       */
      const entryFor = (
        type: keyof typeof tournaments,
        status = 'pending_verification',
      ) => ({
        participant_id: participantId,
        ...tournaments[type],
        name: '山田太郎',
        furigana: 'ヤマダタロウ',
        display_name: '太郎',
        status,
      });
      return {participantId, entryFor};
    }

    // Between tests rather than only at the end: each one seeds the same
    // region slug and email, and a run interrupted earlier would otherwise
    // leave rows that make the next insert fail on the unique constraints.
    async function cleanup() {
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
    }

    beforeEach(cleanup);

    afterAll(async () => {
      await cleanup();
      await sql.close();
    });

    it('rejects a second entry in a region that disallows dual entry', async () => {
      const {entryFor} = await seedRegion(false);
      await sql`insert into entries ${sql(entryFor('saikyoi'))}`;

      // `errno` is where Bun's SQL client puts the SQLSTATE; the same code
      // reaches `lib/entries.ts` as `error.code` through supabase-js.
      let raised: {errno?: string; message?: string} | undefined;
      try {
        await sql`insert into entries ${sql(entryFor('shinjinou'))}`;
      } catch (error) {
        raised = error as {errno?: string; message?: string};
      }

      expect(raised?.errno).toBe('P0005');
      expect(raised?.message).toBe(
        'already entered another tournament in this region',
      );
    });

    it('allows both entries where the region allows dual entry', async () => {
      const {participantId, entryFor} = await seedRegion(true);

      await sql`insert into entries ${sql(entryFor('saikyoi'))}`;
      await sql`insert into entries ${sql(entryFor('shinjinou'))}`;

      const [{count}] = await sql`
        select count(*)::int as count from entries
        where participant_id = ${participantId}
      `;
      expect(count).toBe(2);
    });

    it('does not count a cancelled entry as occupying the region', async () => {
      const {participantId, entryFor} = await seedRegion(false);
      await sql`insert into entries ${sql(entryFor('saikyoi', 'cancelled'))}`;

      await sql`insert into entries ${sql(entryFor('shinjinou'))}`;

      const [{count}] = await sql`
        select count(*)::int as count from entries
        where participant_id = ${participantId} and status <> 'cancelled'
      `;
      expect(count).toBe(1);
    });

    // The status changes on a seat the participant already holds must not go
    // through the check again: `confirm_entry_by_token()` and
    // `promote_next_waitlisted_entry()` run them while holding the
    // tournament lock, and re-taking the participant lock there would invite
    // a deadlock.
    it('leaves a status change on an entry that already holds a seat alone', async () => {
      const {entryFor} = await seedRegion(false);
      const [entry] = await sql`
        insert into entries ${sql(entryFor('saikyoi'))} returning id
      `;

      await sql`update entries set status = 'confirmed' where id = ${entry.id}`;

      const [updated] = await sql`
        select status from entries where id = ${entry.id}
      `;
      expect(updated.status).toBe('confirmed');
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

// The role/scope check constraint added by
// `0015_staff_accounts_scope_and_password_reset.sql`. It exists because a
// half-scoped `regional` row is refused by `middleware/staff-auth.ts` on
// every tournament, so the account 403s silently instead of failing where it
// was created — and rows can still be written straight through Supabase,
// where `StaffAccountCreateInputSchema` isn't in the way.
describe.skipIf(!(await isDbReachable()))(
  'staff_accounts scope constraint (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const staffEmailPrefix = 'staff-scope-test-';
    const staffRegionSlug = 'staff-scope-test-region';

    afterAll(async () => {
      await sql`delete from staff_accounts where email like ${staffEmailPrefix + '%'}`;
      await sql`delete from regions where slug = ${staffRegionSlug}`;
      await sql.close();
    });

    async function insertStaff(
      email: string,
      role: string,
      regionId: string | null,
      tournamentType: string | null,
    ): Promise<void> {
      await sql`
        insert into staff_accounts (
          email, password_hash, role, region_id, tournament_type
        ) values (
          ${email}, 'invalid', ${role}::staff_role, ${regionId},
          ${tournamentType}::tournament_type
        )
      `;
    }

    async function insertThrew(insert: Promise<void>): Promise<boolean> {
      try {
        await insert;
        return false;
      } catch {
        return true;
      }
    }

    it('rejects a regional row without a region', async () => {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${staffRegionSlug}, 'スコープテスト地域')
        returning id
      `;

      expect(
        await insertThrew(
          insertStaff(
            `${staffEmailPrefix}no-region@example.com`,
            'regional',
            null,
            'saikyoi',
          ),
        ),
      ).toBe(true);
      expect(
        await insertThrew(
          insertStaff(
            `${staffEmailPrefix}no-type@example.com`,
            'regional',
            region.id,
            null,
          ),
        ),
      ).toBe(true);
      // A `general` row carrying a scope is refused too: it would read as
      // "restricted to this region" while the middleware waves it through
      // everywhere.
      expect(
        await insertThrew(
          insertStaff(
            `${staffEmailPrefix}scoped-general@example.com`,
            'general',
            region.id,
            'saikyoi',
          ),
        ),
      ).toBe(true);
      // Both halves present is what the API writes, and is accepted.
      expect(
        await insertThrew(
          insertStaff(
            `${staffEmailPrefix}ok@example.com`,
            'regional',
            region.id,
            'saikyoi',
          ),
        ),
      ).toBe(false);
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

// The composite foreign keys are the whole reason `entry_regulations`
// carries a redundant `tournament_id` (migration 0018): before the move to
// multiple selection, `entries.regulation_id` was tied to
// `regulations (id, tournament_id)`, and dropping that guarantee in the
// migration would have let an entry claim another tournament's regulation.
describe.skipIf(!(await isDbReachable()))(
  'entry_regulations table (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'db-schema-entry-regulations-test-region';
    const testEmail = 'db-schema-entry-regulations-test@example.com';

    async function deleteTestData(): Promise<void> {
      // `entry_regulations` goes with its entries (`on delete cascade`).
      await sql`delete from entries where participant_id in (
        select id from participants where email = ${testEmail}
      )`;
      await sql`delete from participants where email = ${testEmail}`;
      await sql`delete from regulations where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlug + '%'}
        )
      )`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug like ${testRegionSlug + '%'}
      )`;
      await sql`delete from regions where slug like ${testRegionSlug + '%'}`;
    }

    beforeEach(deleteTestData);

    afterAll(async () => {
      await deleteTestData();
      await sql.close();
    });

    /**
     * A region with one tournament and one regulation in it.
     * @param suffix The region slug suffix, so two of these can coexist.
     */
    async function seedTournament(suffix: string): Promise<{
      regionId: string;
      tournamentId: string;
      regulationId: string;
    }> {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${testRegionSlug + '-' + suffix}, 'テスト地域')
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
      return {
        regionId: region.id as string,
        tournamentId: tournament.id as string,
        regulationId: regulation.id as string,
      };
    }

    /** An entry into `tournament` by a participant of its region. */
    async function seedEntry(tournament: {
      regionId: string;
      tournamentId: string;
    }): Promise<string> {
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (${tournament.regionId}, ${testEmail}, 'hash')
        returning id
      `;
      const [entry] = await sql`
        insert into entries (
          participant_id, tournament_id, name, furigana, display_name
        ) values (
          ${participant.id}, ${tournament.tournamentId}, '山田太郎',
          'ヤマダタロウ', '太郎'
        )
        returning id
      `;
      return entry.id as string;
    }

    it('accepts several regulations of the entry’s own tournament', async () => {
      const tournament = await seedTournament('multi');
      const [secondRegulation] = await sql`
        insert into regulations (tournament_id, label, display_order)
        values (${tournament.tournamentId}, '2つ目のレギュレーション', 1)
        returning id
      `;
      const entryId = await seedEntry(tournament);

      await sql`
        insert into entry_regulations (entry_id, regulation_id, tournament_id)
        values
          (${entryId}, ${tournament.regulationId}, ${tournament.tournamentId}),
          (${entryId}, ${secondRegulation.id}, ${tournament.tournamentId})
      `;

      const rows = await sql`
        select regulation_id from entry_regulations where entry_id = ${entryId}
      `;
      expect(rows).toHaveLength(2);
    });

    it("refuses another tournament's regulation", async () => {
      const own = await seedTournament('own');
      const other = await seedTournament('other');
      const entryId = await seedEntry(own);

      // Claiming the other tournament's regulation under this entry's own
      // tournament breaks the regulation-side composite key...
      let regulationSideThrew = false;
      try {
        await sql`
          insert into entry_regulations (entry_id, regulation_id, tournament_id)
          values (${entryId}, ${other.regulationId}, ${own.tournamentId})
        `;
      } catch {
        regulationSideThrew = true;
      }
      expect(regulationSideThrew).toBe(true);

      // ...and naming the other tournament instead, so that key resolves,
      // breaks the entry-side one. There is no third option: both keys
      // share `tournament_id`, so no row can satisfy one by lying to the
      // other.
      let entrySideThrew = false;
      try {
        await sql`
          insert into entry_regulations (entry_id, regulation_id, tournament_id)
          values (${entryId}, ${other.regulationId}, ${other.tournamentId})
        `;
      } catch {
        entrySideThrew = true;
      }
      expect(entrySideThrew).toBe(true);
    });

    it('drops an entry’s regulations along with the entry', async () => {
      const tournament = await seedTournament('cascade');
      const entryId = await seedEntry(tournament);
      await sql`
        insert into entry_regulations (entry_id, regulation_id, tournament_id)
        values (${entryId}, ${tournament.regulationId}, ${tournament.tournamentId})
      `;

      await sql`delete from entries where id = ${entryId}`;

      const rows = await sql`
        select regulation_id from entry_regulations where entry_id = ${entryId}
      `;
      expect(rows).toHaveLength(0);
    });
  },
);
