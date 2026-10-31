import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import {readFileSync} from 'node:fs';

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

// Probed once for the whole file rather than per `describe`, so a run without
// a database pays for one failed connection instead of one per block.
const dbReachable = await isDbReachable();

// Requires a running local Supabase instance (`supabase start`); skipped
// automatically when one isn't reachable, e.g. in CI.
describe.skipIf(!dbReachable)(
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
describe.skipIf(!dbReachable)(
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
describe.skipIf(!dbReachable)(
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

    // The backstop for `claim_participant_region()` (0040): a submission that
    // passed it just before a concurrent one moved the account.
    it("refuses a seat outside the participant's region", async () => {
      const {participantId, entryFor} = await seedRegion(false);
      await sql`insert into entries ${sql(entryFor('saikyoi', 'cancelled'))}`;
      const [otherRegion] = await sql`
        insert into regions (slug, name, allows_dual_entry)
        values (${testRegionSlug + '-moved'}, 'テスト地域', false)
        returning id
      `;
      await sql`
        update participants set region_id = ${otherRegion.id}
        where id = ${participantId}
      `;

      let code: string | undefined;
      try {
        await sql`
          update entries set status = 'pending_verification'
          where participant_id = ${participantId}
        `;
      } catch (e: unknown) {
        code = (e as {errno?: string}).errno;
      }
      await sql`delete from entries where participant_id = ${participantId}`;
      await sql`
        update participants set region_id = (
          select id from regions where slug = ${testRegionSlug}
        ) where id = ${participantId}
      `;
      await sql`delete from regions where id = ${otherRegion.id}`;

      expect(code).toBe('P0008');
    });

    it('moves a participant only while nothing holds their old region', async () => {
      const {participantId, entryFor} = await seedRegion(false);
      const [otherRegion] = await sql`
        insert into regions (slug, name, allows_dual_entry)
        values (${testRegionSlug + '-claim'}, 'テスト地域', false)
        returning id
      `;
      const claim = async () => {
        const [row] = await sql`
          select claim_participant_region(
            ${participantId}, ${otherRegion.id}
          ) as claimed
        `;
        return row.claimed as boolean;
      };
      await sql`insert into entries ${sql(entryFor('saikyoi'))}`;

      const whileLive = await claim();
      await sql`update entries set status = 'cancelled'
        where participant_id = ${participantId}`;
      const onceCancelled = await claim();
      const [{region_id: regionId}] = await sql`
        select region_id from participants where id = ${participantId}
      `;
      await sql`delete from entries where participant_id = ${participantId}`;
      await sql`delete from participants where id = ${participantId}`;
      await sql`delete from regions where id = ${otherRegion.id}`;

      expect(whileLive).toBe(false);
      expect(onceCancelled).toBe(true);
      expect(regionId).toBe(otherRegion.id);
    });

    // `claim_participant_region()` and `check_participant_region()` take the
    // participant row in turn, which is all that keeps these two apart.
    it('never leaves a participant in two regions when moving concurrently', async () => {
      const {participantId, entryFor} = await seedRegion(false);
      const [otherRegion] = await sql`
        insert into regions (slug, name, allows_dual_entry)
        values (${testRegionSlug + '-race'}, 'テスト地域', false)
        returning id
      `;
      const [otherTournament] = await sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at
        ) values (
          ${otherRegion.id}, 'saikyoi', 'テスト大会',
          '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z'
        )
        returning id
      `;
      const original = entryFor('saikyoi');
      const moving = new SQL(DB_URL);
      const refusals = new Set<string | undefined>();
      const refused = (e: unknown) => {
        refusals.add((e as {errno?: string}).errno);
      };
      const crossRegionCounts: number[] = [];

      for (let round = 0; round < 20; round++) {
        await sql`delete from entries where participant_id = ${participantId}`;
        await sql`
          update participants
          set region_id = (select id from regions where slug = ${testRegionSlug})
          where id = ${participantId}
        `;
        await Promise.all([
          sql`insert into entries ${sql(original)}`.then(() => {}, refused),
          (async () => {
            const [{claimed}] = await moving`
              select claim_participant_region(
                ${participantId}, ${otherRegion.id}
              ) as claimed
            `;
            if (claimed) {
              await moving`insert into entries ${moving({
                ...original,
                tournament_id: otherTournament.id,
              })}`;
            }
          })().catch(refused),
        ]);
        const [{regions}] = await sql`
          select count(distinct t.region_id)::int as regions
          from entries e
          join tournaments t on t.id = e.tournament_id
          where e.participant_id = ${participantId}
            and e.status <> 'cancelled'
        `;
        crossRegionCounts.push(regions as number);
      }
      await moving.close();
      await sql`delete from entries where participant_id = ${participantId}`;
      await sql`delete from participants where id = ${participantId}`;
      await sql`delete from tournaments where id = ${otherTournament.id}`;
      await sql`delete from regions where id = ${otherRegion.id}`;

      expect(Math.max(...crossRegionCounts)).toBe(1);
      expect([...refusals].filter(code => code !== 'P0008')).toEqual([]);
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
describe.skipIf(!dbReachable)(
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
describe.skipIf(!dbReachable)(
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
describe.skipIf(!dbReachable)(
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
describe.skipIf(!dbReachable)(
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

// The database's copy of the entry length limits (migration 0021). The Zod
// schemas in `packages/shared` are what the API enforces; this check is the
// backstop for rows written with plain SQL.
describe.skipIf(!dbReachable)(
  'entries_text_lengths (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testEmail = 'db-schema-length-test@example.com';
    const testRegionSlug = 'db-schema-length-test-region';

    async function cleanup() {
      await sql`delete from entries where participant_id in (
        select id from participants where email = ${testEmail}
      )`;
      await sql`delete from participants where email = ${testEmail}`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug = ${testRegionSlug}
      )`;
      await sql`delete from regions where slug = ${testRegionSlug}`;
    }

    /** Seeds a tournament and a participant, and returns a valid entry. */
    async function seedEntry() {
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
      return {
        participant_id: participant.id as string,
        tournament_id: tournament.id as string,
        name: '山田太郎',
        furigana: 'やまだたろう',
        display_name: '太郎',
      };
    }

    /**
     * Inserts `entry` and returns the SQLSTATE it was refused with, if any.
     * @param entry The columns to insert.
     * @param customFieldValues The `custom_field_values` to insert with it.
     *     Bound as the object itself: Bun's SQL JSON-encodes a bound string
     *     once more under `::jsonb`, so passing `JSON.stringify()` output
     *     would store a JSON string rather than an object.
     */
    async function insertError(
      entry: Record<string, unknown>,
      customFieldValues: Record<string, string | string[]> = {},
    ): Promise<string | undefined> {
      try {
        await sql`
          insert into entries (
            participant_id, tournament_id, name, furigana, display_name,
            free_text, custom_field_values
          ) values (
            ${entry.participant_id}, ${entry.tournament_id}, ${entry.name},
            ${entry.furigana}, ${entry.display_name}, ${entry.free_text ?? null},
            ${customFieldValues}::jsonb
          )
        `;
        return undefined;
      } catch (error) {
        return (error as {errno?: string}).errno;
      }
    }

    beforeEach(cleanup);

    afterAll(async () => {
      await cleanup();
      await sql.close();
    });

    it('accepts values at the maximum lengths', async () => {
      const entry = await seedEntry();

      const errno = await insertError(
        {
          ...entry,
          display_name: 'あ'.repeat(100),
          free_text: 'あ'.repeat(2000),
        },
        {
          note: 'あ'.repeat(2000),
          allergies: Array.from({length: 4}, () => 'あ'.repeat(2000)),
        },
      );

      expect(errno).toBeUndefined();
    });

    it('entries rejects an over-long display_name', async () => {
      const entry = await seedEntry();

      const errno = await insertError({
        ...entry,
        display_name: 'あ'.repeat(101),
      });

      // check_violation
      expect(errno).toBe('23514');
    });

    it('entries rejects custom field answers over the combined maximum', async () => {
      const entry = await seedEntry();

      const errno = await insertError(entry, {
        note: 'あ'.repeat(2000),
        allergies: Array.from({length: 5}, () => 'あ'.repeat(1601)),
      });

      expect(errno).toBe('23514');
    });
  },
);

// The indexes added in migration 0022 (and the regulations one from 0014
// that 0022 deliberately doesn't repeat). Checked by leading column rather
// than by name, since what matters is whether `where <column> = ?` can use
// one.
describe.skipIf(!dbReachable)(
  'add_staff_password_link (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testEmail = 'db-schema-add-link-test@example.com';

    async function cleanup() {
      await sql`delete from staff_accounts where email = ${testEmail}`;
    }

    beforeEach(cleanup);
    afterAll(async () => {
      await cleanup();
      await sql.close();
    });

    async function seedGeneralAccount(disabled = false): Promise<string> {
      const [account] = await sql`
        insert into staff_accounts (email, password_hash, role, disabled_at)
        values (
          ${testEmail}, 'invalid', 'general',
          ${disabled ? new Date().toISOString() : null}
        )
        returning id
      `;
      return account.id as string;
    }

    async function tokenHashes(accountId: string): Promise<string[]> {
      const rows = await sql`
        select token_hash from staff_password_reset_tokens
        where staff_account_id = ${accountId}
        order by token_hash
      `;
      return rows.map((row: {token_hash: string}) => row.token_hash);
    }

    // #175: a request anyone can make must not throw away the invitation a
    // general staff member sent; only links that ran out are pruned.
    it('keeps live links and drops expired ones', async () => {
      const accountId = await seedGeneralAccount();
      await sql`
        insert into staff_password_reset_tokens
          (staff_account_id, token_hash, expires_at)
        values
          (${accountId}, 'live-invite', now() + interval '1 day'),
          (${accountId}, 'expired-link', now() - interval '1 minute')
      `;

      await sql`
        select add_staff_password_link(
          ${accountId}, 'requested-link', now() + interval '1 hour'
        )
      `;

      expect(await tokenHashes(accountId)).toEqual([
        'live-invite',
        'requested-link',
      ]);
    });

    it('refuses a disabled account without writing a link', async () => {
      const accountId = await seedGeneralAccount(true);

      let code: string | undefined;
      try {
        await sql`
          select add_staff_password_link(
            ${accountId}, 'requested-link', now() + interval '1 hour'
          )
        `;
      } catch (e) {
        code = (e as {errno?: string}).errno;
      }

      expect(code).toBe('P0005');
      expect(await tokenHashes(accountId)).toEqual([]);
    });
  },
);

describe.skipIf(!dbReachable)('indexes (local Supabase integration)', () => {
  const sql = new SQL(DB_URL);

  afterAll(async () => {
    await sql.close();
  });

  /**
   * Lists the indexes on a table whose leading column is the given one.
   *
   * Partial indexes are left out because they only serve queries that
   * repeat their predicate, and invalid or not-yet-ready ones (a failed
   * `create index concurrently`) because the planner won't use them.
   * @param table The table to inspect.
   * @param column The column the index has to lead with.
   * @return The names of the matching indexes.
   */
  async function indexesLeadingWith(
    table: string,
    column: string,
  ): Promise<string[]> {
    // `indkey` is an `int2vector`, which is subscripted from 0.
    const rows = await sql`
        select i.indexrelid::regclass::text as name
          from pg_index i
          join pg_attribute a
            on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
          where i.indrelid = ${table}::regclass
            and a.attname = ${column}
            and i.indpred is null
            and i.indisvalid
            and i.indisready
      `;
    return rows.map((row: {name: string}) => row.name);
  }

  it('email_verification_tokens has an index on entry_id', async () => {
    const indexes = await indexesLeadingWith(
      'email_verification_tokens',
      'entry_id',
    );
    expect(indexes.length).toBeGreaterThan(0);
  });

  it('participants has an index on region_id', async () => {
    const indexes = await indexesLeadingWith('participants', 'region_id');
    expect(indexes.length).toBeGreaterThan(0);
  });

  it('staff_accounts has an index on region_id', async () => {
    const indexes = await indexesLeadingWith('staff_accounts', 'region_id');
    expect(indexes.length).toBeGreaterThan(0);
  });

  it('regulations has exactly one index usable for a tournament_id lookup (no duplicate)', async () => {
    expect(await indexesLeadingWith('regulations', 'tournament_id')).toEqual([
      'regulations_tournament_id_display_order_idx',
    ]);
  });
});

// Migration 0034 (#189): which existing accounts count as verified, and the
// takeover of one that doesn't.
describe.skipIf(!dbReachable)(
  'participants.email_verified_at (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testEmailDomain = 'db-schema-verified-test.example.com';
    const testRegionSlug = 'db-schema-verified-test-region';

    async function cleanup() {
      await sql`delete from email_verification_tokens where entry_id in (
        select e.id from entries e
        join participants p on p.id = e.participant_id
        where p.email like ${'%@' + testEmailDomain}
      )`;
      await sql`delete from entries where participant_id in (
        select id from participants where email like ${'%@' + testEmailDomain}
      )`;
      await sql`delete from participants where email like ${'%@' + testEmailDomain}`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug like ${testRegionSlug + '%'}
      )`;
      await sql`delete from regions where slug like ${testRegionSlug + '%'}`;
    }

    beforeEach(cleanup);

    afterAll(async () => {
      await cleanup();
      await sql.close();
    });

    /**
     * A region with one tournament, and an unverified participant in it.
     * @param suffix Tells this test's rows apart from the others'.
     */
    async function seed(suffix: string) {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${testRegionSlug + '-' + suffix}, 'テスト地域')
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at
        ) values (${region.id}, 'saikyoi', 'テスト大会', now(), now())
        returning id
      `;
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (${region.id}, ${suffix + '@' + testEmailDomain}, 'old-hash')
        returning id
      `;
      /**
       * Enters the participant with `status`, verified at `verifiedAt`.
       * @param status The entry's status.
       * @param verifiedAt Its `email_verified_at`.
       */
      const enter = async (status: string, verifiedAt: string | null) => {
        const [entry] = await sql`
          insert into entries (
            participant_id, tournament_id, name, furigana, display_name,
            status, email_verified_at
          ) values (
            ${participant.id}, ${tournament.id}, '山田太郎', 'ヤマダタロウ',
            '太郎', ${status}, ${verifiedAt}
          )
          returning id
        `;
        return entry.id as string;
      };
      return {
        regionId: region.id as string,
        participantId: participant.id as string,
        enter,
      };
    }

    /**
     * The backfill statement of the migration, read from the file itself so
     * the test runs what was actually applied.
     */
    function backfillStatement(): string {
      const migration = readFileSync(
        new URL(
          '../../../../supabase/migrations/0034_participants_email_verified_at.sql',
          import.meta.url,
        ),
        'utf8',
      );
      const start = migration.indexOf('update participants p');
      return migration.slice(start, migration.indexOf(';', start) + 1);
    }

    it('backfills accounts with a confirmed entry, at its earliest time', async () => {
      const verified = await seed('backfill-verified');
      // A cancelled entry that was confirmed before still proves the address.
      await verified.enter('cancelled', '2026-05-01T00:00:00Z');
      const pendingOnly = await seed('backfill-pending');
      await pendingOnly.enter('pending_verification', null);
      const rollback = new Error('rollback');

      // Run inside a transaction that is rolled back, so the statement --
      // which touches every participant -- leaves the rest of the local
      // database as it found it.
      let rows: Array<{id: string; email_verified_at: Date | null}> = [];
      try {
        await sql.begin(async tx => {
          await tx`
            update participants set email_verified_at = null
            where id in (${verified.participantId}, ${pendingOnly.participantId})
          `;
          await tx.unsafe(backfillStatement());
          rows = await tx`
            select id, email_verified_at from participants
            where id in (${verified.participantId}, ${pendingOnly.participantId})
          `;
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }

      const byId = new Map(rows.map(row => [row.id, row.email_verified_at]));
      expect(byId.get(verified.participantId)).toEqual(
        new Date('2026-05-01T00:00:00Z'),
      );
      expect(byId.get(pendingOnly.participantId)).toBeNull();
    });

    // Re-entering a cancelled tournament reuses its row and clears its
    // `email_verified_at`, so a participant who confirmed, cancelled and
    // entered again keeps no confirmed entry; the reused row is what tells.
    it('backfills accounts whose entry row was reused, but not fresh ones', async () => {
      const reused = await seed('backfill-reused');
      const reusedEntryId = await reused.enter('pending_verification', null);
      const fresh = await seed('backfill-fresh');
      const freshEntryId = await fresh.enter('pending_verification', null);
      const rollback = new Error('rollback');

      let rows: Array<{id: string; email_verified_at: Date | null}> = [];
      try {
        await sql.begin(async tx => {
          await tx`
            update entries set created_at = '2026-05-01T00:00:00Z'
            where id = ${reusedEntryId}
          `;
          await tx`
            insert into email_verification_tokens (entry_id, token_hash, expires_at)
            values
              (${reusedEntryId}, ${'backfill-reused-' + reusedEntryId},
               '2026-06-01T00:00:00Z'),
              (${freshEntryId}, ${'backfill-fresh-' + freshEntryId},
               now() + interval '24 hours')
          `;
          await tx`
            update participants set email_verified_at = null
            where id in (${reused.participantId}, ${fresh.participantId})
          `;
          await tx.unsafe(backfillStatement());
          rows = await tx`
            select id, email_verified_at from participants
            where id in (${reused.participantId}, ${fresh.participantId})
          `;
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }

      const byId = new Map(rows.map(row => [row.id, row.email_verified_at]));
      expect(byId.get(reused.participantId)).toEqual(
        new Date('2026-05-01T00:00:00Z'),
      );
      expect(byId.get(fresh.participantId)).toBeNull();
    });

    it('take_over_unverified_participant replaces an unverified account', async () => {
      const {participantId, enter} = await seed('takeover');
      const pendingId = await enter('pending_verification', null);
      const [tournament] = await sql`
        select tournament_id from entries where id = ${pendingId}
      `;
      await sql`
        insert into email_verification_tokens (entry_id, token_hash, expires_at)
        values (${pendingId}, 'db-schema-takeover-token', now() + interval '1 day')
      `;
      const [other] = await sql`
        insert into regions (slug, name)
        values (${testRegionSlug + '-takeover-other'}, '別の地域')
        returning id
      `;

      // As JSON, the way PostgREST hands the array to the app; Bun's client
      // would otherwise leave a `uuid[]` as its text literal.
      const [{tookOver}] = await sql`
        select to_jsonb(take_over_unverified_participant(
          ${participantId}, 'new-hash', ${other.id}
        )) as "tookOver"
      `;

      // The pending entry it withdrew, for the new entry's mail to report.
      expect(tookOver).toEqual([tournament.tournament_id]);
      const [row] = await sql`
        select region_id, password_hash, email_verified_at from participants
        where id = ${participantId}
      `;
      expect(row).toEqual({
        region_id: other.id,
        password_hash: 'new-hash',
        email_verified_at: null,
      });
      expect(
        await sql`select id from entries where participant_id = ${participantId}`,
      ).toHaveLength(0);
    });

    it('take_over_unverified_participant leaves a verified account alone', async () => {
      const {participantId, regionId} = await seed('takeover-verified');
      await sql`
        update participants set email_verified_at = now()
        where id = ${participantId}
      `;

      const [{tookOver}] = await sql`
        select take_over_unverified_participant(
          ${participantId}, 'new-hash', ${regionId}
        ) as "tookOver"
      `;

      expect(tookOver).toBeNull();
      const [row] = await sql`
        select password_hash from participants where id = ${participantId}
      `;
      expect(row.password_hash).toBe('old-hash');
    });

    // Belt and braces for an account the backfill missed: a confirmed entry
    // proves the address whatever the participant row says.
    it('take_over_unverified_participant leaves an account with a confirmed entry alone', async () => {
      const {participantId, regionId, enter} = await seed('takeover-confirmed');
      await enter('confirmed', '2026-05-01T00:00:00Z');

      const [{tookOver}] = await sql`
        select take_over_unverified_participant(
          ${participantId}, 'new-hash', ${regionId}
        ) as "tookOver"
      `;

      expect(tookOver).toBeNull();
    });

    // A confirmation that commits while the takeover waits for the
    // participant lock has to be seen by the verified-entry check, which a
    // subquery of the locking statement would judge by the snapshot it
    // started with. The confirmation here stamps only the entry, as one
    // the backfill missed would look.
    it('take_over_unverified_participant sees an entry confirmed while it waited for the lock', async () => {
      const {participantId, regionId, enter} = await seed('takeover-waiting');
      const entryId = await enter('pending_verification', null);

      const confirming = await sql.reserve();
      try {
        await confirming`begin`;
        await confirming`
          select 1 from participants where id = ${participantId}
          for no key update
        `;
        await confirming`
          update entries
          set status = 'confirmed', email_verified_at = now()
          where id = ${entryId}
        `;
        const takeOver = sql`
          select to_jsonb(take_over_unverified_participant(
            ${participantId}, 'new-hash', ${regionId}
          )) as "tookOver"
        `.execute();
        // Long enough for the takeover to be queued on the lock.
        await Bun.sleep(300);
        await confirming`commit`;

        const [{tookOver}] = await takeOver;
        expect(tookOver).toBeNull();
      } finally {
        confirming.release();
      }
      const [row] = await sql`
        select password_hash from participants where id = ${participantId}
      `;
      expect(row.password_hash).toBe('old-hash');
    });
  },
);
