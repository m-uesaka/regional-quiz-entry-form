import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'bun:test';
import {SQL, type ReservedSQL} from 'bun';
import {readFileSync} from 'node:fs';
import {
  DUAL_ENTRY_SHARED_QUESTION_SET_SQLSTATE,
  PARTICIPANT_REGION_SQLSTATE,
  REGION_DUAL_ENTRY_SQLSTATE,
  STAFF_ACCOUNT_DISABLED_SQLSTATE,
  TOURNAMENT_REGION_TYPE_LOCKED_SQLSTATE,
} from '../lib/pg-errors';
import {
  CUSTOM_FIELD_VALUE_MAX_LENGTH,
  CUSTOM_FIELD_VALUES_TOTAL_MAX_LENGTH,
  ENTRY_FREE_TEXT_MAX_LENGTH,
  ENTRY_NAME_MAX_LENGTH,
} from '@regional-quiz/shared';
import {DB_URL, isDbReachable} from '../test-support/db';

// Probed once for the whole file rather than per `describe`, so a run without
// a database pays for one failed connection instead of one per block.
const dbReachable = await isDbReachable();

// Requires a running local Supabase instance (`supabase start`); skipped
// automatically when one isn't reachable locally; see `test-support/db.ts`.
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
          ${region.id}, 'saikyoi', 'テスト大会', now() - interval '1 day', now()
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

// The default is what the dual-entry rule (`check_entry_seat()`, migration
// 0041) falls back to for every region that predates the column, so it is pinned down here
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

// The only place the rule of `regions.allows_dual_entry` is enforced, and the
// backstop for `claim_participant_region()` (migration 0041). `createEntry()`
// has no check of its own for the former (#200): these tests are what pin the
// rule down.
describe.skipIf(!dbReachable)(
  'check_entry_seat() (local Supabase integration)',
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
            ${region.id}, ${type}, ${'テスト' + type}, now() - interval '1 day', now()
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
          select id from regions where slug like ${testRegionSlug + '%'}
        )
      )`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug like ${testRegionSlug + '%'}
      )`;
      await sql`delete from regions where slug like ${testRegionSlug + '%'}`;
    }

    beforeEach(cleanup);

    /**
     * Creates another region with a 最強位 tournament, for entries across
     * regions. `cleanup()` removes it with the rest.
     * @param suffix Makes the region's slug unique within the test.
     * @param questionSet The tournament's question set (`null`: the common
     *     one of its type).
     * @param type The tournament's type.
     * @return The tournament's id.
     */
    async function seedOtherRegionTournament(
      suffix: string,
      questionSet: string | null = null,
      type: 'saikyoi' | 'shinjinou' = 'saikyoi',
    ): Promise<string> {
      const [region] = await sql`
        insert into regions (slug, name, allows_dual_entry)
        values (${testRegionSlug + '-' + suffix}, '別のテスト地域', false)
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at, question_set
        ) values (
          ${region.id}, ${type}, '別のテスト大会', now() - interval '1 day', now(),
          ${questionSet}
        )
        returning id
      `;
      return tournament.id as string;
    }

    /**
     * Sets the question set of the seeded region's two tournaments.
     * @param questionSet The question set, or `null` for the common one.
     */
    async function setOwnQuestionSet(questionSet: string | null) {
      await sql`
        update tournaments set question_set = ${questionSet}
        where region_id = (select id from regions where slug = ${testRegionSlug})
      `;
    }

    afterAll(async () => {
      await cleanup();
      await sql.close();
    });

    /**
     * Re-enters a cancelled entry the way `enterTournament()` does.
     * @param conn The connection to run on.
     * @param entryId The cancelled entry.
     * @param participantId Its participant.
     * @return The entry as re-entered: no row if it wasn't cancelled.
     */
    function reenter(conn: SQL, entryId: string, participantId: string) {
      return conn`
        select * from reenter_cancelled_entry(
          ${entryId}, ${participantId}, '鈴木花子', 'スズキハナコ', '花子',
          null, '{}'
        )
      `;
    }

    /**
     * The SQLSTATE a query was refused with, or undefined if it succeeded.
     * A failure that isn't Postgres refusing it, such as a lost connection,
     * is thrown, so that it can't read as a success.
     * @param query The query.
     */
    async function refusalOf(query: PromiseLike<unknown>) {
      try {
        await query;
        return undefined;
      } catch (e: unknown) {
        const {errno} = e as {errno?: string};
        if (!errno) {
          throw e;
        }
        return errno;
      }
    }

    /**
     * Hands a reserved connection back clean, whether the test finished on it
     * or threw half way: a transaction left open would hold its locks against
     * `cleanup()`, and hang the suite instead of failing one test.
     * @param conn The connection.
     */
    async function releaseClean(conn: ReservedSQL) {
      try {
        await conn`rollback`;
        await conn`set lock_timeout = 0`;
      } finally {
        conn.release();
      }
    }

    /**
     * Adds a verification token to an entry.
     * @param entryId The entry.
     * @param state A used token, an expired one or a live one.
     * @return The token's id.
     */
    async function addToken(
      entryId: string,
      state: 'used' | 'expired' | 'live',
    ): Promise<string> {
      const [token] = await sql`
        insert into email_verification_tokens
          (entry_id, token_hash, expires_at, used_at)
        values (
          ${entryId},
          ${crypto.randomUUID()},
          now() + ${state === 'expired' ? '-1 hour' : '1 hour'}::interval,
          ${state === 'used' ? new Date() : null}
        )
        returning id
      `;
      return token.id as string;
    }

    /**
     * The ids of an entry's verification tokens.
     * @param entryId The entry.
     */
    async function tokenIdsOf(entryId: string): Promise<string[]> {
      const rows = await sql`
        select id from email_verification_tokens where entry_id = ${entryId}
      `;
      return rows.map((row: {id: string}) => row.id);
    }

    it('fires a single check on entries, with the two old functions gone', async () => {
      const triggers = await sql`
        select tgname from pg_trigger
        where tgrelid = 'entries'::regclass
          and not tgisinternal
          and tgname like 'entries_check_%'
      `;
      const functions = await sql`
        select proname from pg_proc
        where proname in ('check_region_dual_entry', 'check_participant_region')
      `;

      expect(triggers.map((row: {tgname: string}) => row.tgname)).toEqual([
        'entries_check_seat',
      ]);
      expect(functions).toHaveLength(0);
    });

    it('checks the region before the other tournament', async () => {
      const {entryFor} = await seedRegion(false);
      // A 新人王, so that the 新人王 entered below shares its common
      // questions (0046).
      const otherTournamentId = await seedOtherRegionTournament(
        'order',
        null,
        'shinjinou',
      );
      await sql`insert into entries ${sql({
        ...entryFor('saikyoi'),
        tournament_id: otherTournamentId,
      })}`;
      // Different question sets while the two seats are taken, the same one
      // afterwards: the entry below breaks both rules at once.
      await setOwnQuestionSet('独自');
      await sql`insert into entries ${sql(entryFor('saikyoi'))}`;
      await setOwnQuestionSet(null);

      const code = await refusalOf(
        sql`insert into entries ${sql(entryFor('shinjinou'))}`,
      );

      expect(code).toBe(PARTICIPANT_REGION_SQLSTATE);
    });

    it('resets a re-entered row to what a fresh entry would be', async () => {
      const {participantId, entryFor} = await seedRegion(false);
      const [entry] = await sql`
        insert into entries ${sql({
          ...entryFor('saikyoi', 'cancelled'),
          free_text: '前回の回答',
          email_verified_at: '2026-05-01T00:00:00Z',
          cancelled_at: '2026-05-02T00:00:00Z',
        })}
        returning id
      `;

      const rows = await reenter(sql, entry.id, participantId);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: entry.id,
        participant_id: participantId,
        name: '鈴木花子',
        furigana: 'スズキハナコ',
        display_name: '花子',
        free_text: null,
        custom_field_values: {},
        status: 'pending_verification',
        waitlist_position: null,
        email_verified_at: null,
        cancelled_at: null,
      });
    });

    it('drops only the dead tokens of the row it re-enters', async () => {
      const {participantId, entryFor} = await seedRegion(false);
      const [entry] = await sql`
        insert into entries ${sql(entryFor('saikyoi', 'cancelled'))}
        returning id
      `;
      await addToken(entry.id, 'used');
      await addToken(entry.id, 'expired');
      const live = await addToken(entry.id, 'live');

      await reenter(sql, entry.id, participantId);

      expect(await tokenIdsOf(entry.id)).toEqual([live]);
      await sql`
        delete from email_verification_tokens where entry_id = ${entry.id}
      `;
    });

    it('keeps the tokens of a re-entry it refuses', async () => {
      const {participantId, entryFor} = await seedRegion(false);
      const [cancelled] = await sql`
        insert into entries ${sql(entryFor('saikyoi', 'cancelled'))}
        returning id
      `;
      await sql`insert into entries ${sql(entryFor('shinjinou'))}`;
      const used = await addToken(cancelled.id, 'used');

      const code = await refusalOf(reenter(sql, cancelled.id, participantId));

      expect(code).toBe(REGION_DUAL_ENTRY_SQLSTATE);
      expect(await tokenIdsOf(cancelled.id)).toEqual([used]);
      await sql`
        delete from email_verification_tokens where entry_id = ${cancelled.id}
      `;
    });

    it('leaves the tokens of a row that is no longer cancelled', async () => {
      const {participantId, entryFor} = await seedRegion(true);
      const [entry] = await sql`
        insert into entries ${sql(entryFor('saikyoi'))} returning id
      `;
      const used = await addToken(entry.id, 'used');

      const rows = await reenter(sql, entry.id, participantId);

      expect(rows).toHaveLength(0);
      expect(await tokenIdsOf(entry.id)).toEqual([used]);
      await sql`
        delete from email_verification_tokens where entry_id = ${entry.id}
      `;
    });

    it("re-enters nothing but the participant's own cancelled row", async () => {
      const {participantId, entryFor} = await seedRegion(true);
      const [held] = await sql`
        insert into entries ${sql(entryFor('saikyoi'))} returning id
      `;
      const [cancelled] = await sql`
        insert into entries ${sql(entryFor('shinjinou', 'cancelled'))}
        returning id
      `;

      const notCancelled = await reenter(sql, held.id, participantId);
      const notOwn = await reenter(
        sql,
        cancelled.id,
        '00000000-0000-0000-0000-000000000000',
      );

      expect(notCancelled).toHaveLength(0);
      expect(notOwn).toHaveLength(0);
    });

    it('refuses a re-entry in the same way as a first entry', async () => {
      const {participantId, entryFor} = await seedRegion(false);
      const [cancelled] = await sql`
        insert into entries ${sql(entryFor('saikyoi', 'cancelled'))}
        returning id
      `;
      await sql`insert into entries ${sql(entryFor('shinjinou'))}`;

      const dualEntry = await refusalOf(
        reenter(sql, cancelled.id, participantId),
      );

      await sql`
        update entries set status = 'cancelled'
        where participant_id = ${participantId}
      `;
      const otherTournamentId = await seedOtherRegionTournament('reenter');
      await sql`insert into entries ${sql({
        ...entryFor('saikyoi'),
        tournament_id: otherTournamentId,
      })}`;
      const otherRegionEntry = await refusalOf(
        reenter(sql, cancelled.id, participantId),
      );

      expect(dualEntry).toBe(REGION_DUAL_ENTRY_SQLSTATE);
      expect(otherRegionEntry).toBe(PARTICIPANT_REGION_SQLSTATE);
    });

    // Migrations run before the Worker is deployed, so the Worker of the
    // previous release writes re-entries directly for a while after 0041.
    it('still checks a re-entry written directly to the table', async () => {
      const {participantId, entryFor} = await seedRegion(false);
      const [first] = await sql`
        insert into entries ${sql(entryFor('saikyoi', 'cancelled'))}
        returning id
      `;
      const [second] = await sql`
        insert into entries ${sql(entryFor('shinjinou', 'cancelled'))}
        returning id
      `;
      const directly = (id: string) => sql`
        update entries
        set status = 'pending_verification', cancelled_at = null
        where id = ${id} and status = 'cancelled'
        returning id
      `;

      const [reentered] = await directly(first.id);
      const code = await refusalOf(directly(second.id));

      expect(reentered.id).toBe(first.id);
      expect(code).toBe(REGION_DUAL_ENTRY_SQLSTATE);
      const [row] = await sql`
        select count(*)::int as live from entries
        where participant_id = ${participantId} and status <> 'cancelled'
      `;
      expect(row.live).toBe(1);
    });

    // What `take_over_unverified_participant()` deadlocked against: an update
    // straight to the table locks the entry first and then waits here. The
    // entry being free to lock is what shows the participant comes first.
    it('takes the participant row before the entry row on a re-entry', async () => {
      const {participantId, entryFor} = await seedRegion(false);
      const [entry] = await sql`
        insert into entries ${sql(entryFor('saikyoi', 'cancelled'))}
        returning id
      `;

      const holder = await sql.reserve();
      let queued: PromiseLike<unknown> | undefined;
      try {
        await holder`begin`;
        await holder`
          select 1 from participants where id = ${participantId}
          for no key update
        `;
        const reentry = reenter(sql, entry.id, participantId).execute();
        queued = reentry;
        // Long enough for the re-entry to be queued on the lock.
        await Bun.sleep(300);

        const locked = await holder`
          select id from entries where id = ${entry.id} for update nowait
        `;
        await holder`commit`;

        expect(locked).toHaveLength(1);
        expect(await reentry).toHaveLength(1);
      } finally {
        await releaseClean(holder);
        await Promise.allSettled([queued]);
      }
    });

    it('sees the row a takeover deleted while it waited for the lock', async () => {
      const {participantId, entryFor} = await seedRegion(false);
      const [regionRow] = await sql`
        select region_id from participants where id = ${participantId}
      `;
      const [entry] = await sql`
        insert into entries ${sql(entryFor('saikyoi', 'cancelled'))}
        returning id
      `;

      const takingOver = await sql.reserve();
      let queued: PromiseLike<unknown> | undefined;
      try {
        await takingOver`begin`;
        await takingOver`
          select take_over_unverified_participant(
            ${participantId}, 'new-hash', ${regionRow.region_id}
          )
        `;
        const reentry = reenter(sql, entry.id, participantId).execute();
        queued = reentry;
        await Bun.sleep(300);
        await takingOver`commit`;

        expect(await reentry).toHaveLength(0);
      } finally {
        await releaseClean(takingOver);
        await Promise.allSettled([queued]);
      }
    });

    it('does not deadlock a re-entry with a takeover', async () => {
      const {participantId, entryFor} = await seedRegion(false);
      const [regionRow] = await sql`
        select region_id from participants where id = ${participantId}
      `;
      const takingOver = new SQL(DB_URL);
      const refusals: Array<string | undefined> = [];

      try {
        for (let round = 0; round < 20; round++) {
          await sql`delete from entries where participant_id = ${participantId}`;
          const [entry] = await sql`
            insert into entries ${sql(entryFor('saikyoi', 'cancelled'))}
            returning id
          `;
          refusals.push(
            ...(await Promise.all([
              refusalOf(reenter(sql, entry.id, participantId)),
              refusalOf(takingOver`
                select take_over_unverified_participant(
                  ${participantId}, 'new-hash', ${regionRow.region_id}
                )
              `),
            ])),
          );
        }
      } finally {
        await takingOver.close();
      }

      expect(refusals.filter(code => code !== undefined)).toEqual([]);
    });

    // `for update` here would also block a foreign key check against the
    // participant, which is what the weaker lock is for.
    it('leaves a foreign key check through while a seat is being taken', async () => {
      const {participantId, entryFor} = await seedRegion(false);

      const entering = await sql.reserve();
      try {
        await entering`begin`;
        await entering`insert into entries ${entering(entryFor('saikyoi'))}`;

        const code = await refusalOf(sql`
          select 1 from participants where id = ${participantId}
          for key share nowait
        `);

        expect(code).toBeUndefined();
      } finally {
        await releaseClean(entering);
      }
    });

    // Those paths hold the tournament lock and never the participant's, and
    // an insert holds the participant's while it waits for the tournament's.
    // Waiting here would be half of that deadlock, so the participant row is
    // held throughout and any wait on it fails the test.
    it('takes no participant lock on a row that already holds a seat', async () => {
      const {participantId, entryFor} = await seedRegion(false);
      const [entry] = await sql`
        insert into entries ${sql({
          ...entryFor('saikyoi', 'waitlisted'),
          waitlist_position: 1,
        })}
        returning id, tournament_id
      `;

      const holder = await sql.reserve();
      const writer = await sql.reserve();
      try {
        await holder`begin`;
        await holder`
          select 1 from participants where id = ${participantId} for update
        `;
        await writer`set lock_timeout = '1s'`;

        const promoted = await writer`
          select * from promote_waitlisted_entries(${entry.tournament_id})
        `;
        const [cancelled] = await writer`
          select * from cancel_own_entry(${entry.id}, ${participantId})
        `;

        expect(promoted).toHaveLength(1);
        expect(cancelled.previous_status).toBe('confirmed');
      } finally {
        await releaseClean(writer);
        await releaseClean(holder);
      }
    });

    it('rejects a second entry in a region that disallows dual entry', async () => {
      const {entryFor} = await seedRegion(false);
      await sql`insert into entries ${sql(entryFor('saikyoi'))}`;

      // `errno` is where Bun's SQL client puts the SQLSTATE; the same code
      // reaches `lib/entry-submission.ts` as `error.code` through supabase-js.
      let raised: {errno?: string; message?: string} | undefined;
      try {
        await sql`insert into entries ${sql(entryFor('shinjinou'))}`;
      } catch (error) {
        raised = error as {errno?: string; message?: string};
      }

      expect(raised?.errno).toBe(REGION_DUAL_ENTRY_SQLSTATE);
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

    // The backstop for `claim_participant_region_for_tournament()` (0043): a
    // submission that passed it just before a concurrent one took a seat in
    // another region on the same question set.
    it('refuses a seat while another region on the same question set is held', async () => {
      const {participantId, entryFor} = await seedRegion(false);
      await sql`insert into entries ${sql(entryFor('saikyoi', 'cancelled'))}`;
      const otherTournamentId = await seedOtherRegionTournament('moved');
      await sql`insert into entries ${sql({
        ...entryFor('saikyoi'),
        tournament_id: otherTournamentId,
      })}`;

      const code = await refusalOf(sql`
        update entries set status = 'pending_verification'
        where participant_id = ${participantId}
          and tournament_id = ${entryFor('saikyoi').tournament_id}
      `);

      expect(code).toBe(PARTICIPANT_REGION_SQLSTATE);
    });

    // 宮崎 and 鹿児島 each use questions of their own (0043): an entry in
    // one doesn't rule out the other, nor a region on the common questions.
    it('allows seats in regions using different question sets', async () => {
      const {participantId, entryFor} = await seedRegion(false);
      const ownSetTournamentId = await seedOtherRegionTournament(
        'own-set',
        '宮崎',
      );
      const otherOwnSetTournamentId = await seedOtherRegionTournament(
        'other-own-set',
        '鹿児島',
      );

      await sql`insert into entries ${sql(entryFor('saikyoi'))}`;
      await sql`insert into entries ${sql({
        ...entryFor('saikyoi'),
        tournament_id: ownSetTournamentId,
      })}`;
      await sql`insert into entries ${sql({
        ...entryFor('saikyoi'),
        tournament_id: otherOwnSetTournamentId,
      })}`;

      const [{count}] = await sql`
        select count(*)::int as count from entries
        where participant_id = ${participantId} and status <> 'cancelled'
      `;
      expect(count).toBe(3);
    });

    it('refuses seats in two regions sharing a question set of their own', async () => {
      const {entryFor} = await seedRegion(false);
      await setOwnQuestionSet('宮崎');
      const sameSetTournamentId = await seedOtherRegionTournament(
        'same-set',
        '宮崎',
      );
      await sql`insert into entries ${sql(entryFor('saikyoi'))}`;

      const code = await refusalOf(
        sql`insert into entries ${sql({
          ...entryFor('saikyoi'),
          tournament_id: sameSetTournamentId,
        })}`,
      );

      expect(code).toBe(PARTICIPANT_REGION_SQLSTATE);
    });

    // As in 0040: a confirmed entry cancelled after its tournament closed
    // still holds the region, but only against the same question set.
    it('holds a region for a late cancellation only on the same question set', async () => {
      const {entryFor} = await seedRegion(false);
      const otherTournamentId = await seedOtherRegionTournament('late');
      await sql`insert into entries ${sql({
        ...entryFor('saikyoi', 'cancelled'),
        tournament_id: otherTournamentId,
        email_verified_at: '2026-05-01T00:00:00Z',
        cancelled_at: '2099-01-01T00:00:00Z',
      })}`;

      const sameSet = await refusalOf(
        sql`insert into entries ${sql(entryFor('saikyoi'))}`,
      );
      await setOwnQuestionSet('独自');
      const otherSet = await refusalOf(
        sql`insert into entries ${sql(entryFor('saikyoi'))}`,
      );

      expect(sameSet).toBe(PARTICIPANT_REGION_SQLSTATE);
      expect(otherSet).toBeUndefined();
    });

    // Question sets are per tournament: the region a participant already
    // takes part in can still hold a tournament that conflicts elsewhere.
    it("checks each tournament's question set, not the region's", async () => {
      const {entryFor} = await seedRegion(true);
      await sql`
        update tournaments set question_set = '宮崎'
        where id = ${entryFor('saikyoi').tournament_id}
      `;
      // A 新人王 on the common questions, as this region's 新人王 is.
      const otherTournamentId = await seedOtherRegionTournament(
        'per-tournament',
        null,
        'shinjinou',
      );
      await sql`insert into entries ${sql(entryFor('saikyoi'))}`;
      await sql`insert into entries ${sql({
        ...entryFor('saikyoi'),
        tournament_id: otherTournamentId,
      })}`;

      const code = await refusalOf(
        sql`insert into entries ${sql(entryFor('shinjinou'))}`,
      );

      expect(code).toBe(PARTICIPANT_REGION_SQLSTATE);
    });

    // 0046: the common questions are one set per type -- 最強位 and 新人王 don't
    // share their questions -- while a name is compared as it is, whatever
    // the type.
    it('compares the common questions within a type only', async () => {
      const {entryFor} = await seedRegion(false);
      const otherShinjinou = await seedOtherRegionTournament(
        'common-shinjinou',
        null,
        'shinjinou',
      );
      const otherSaikyoi = await seedOtherRegionTournament('common-saikyoi');
      await sql`insert into entries ${sql(entryFor('saikyoi'))}`;

      const acrossTypes = await refusalOf(
        sql`insert into entries ${sql({
          ...entryFor('saikyoi'),
          tournament_id: otherShinjinou,
        })}`,
      );
      await sql`delete from entries where tournament_id = ${otherShinjinou}`;
      const sameType = await refusalOf(
        sql`insert into entries ${sql({
          ...entryFor('saikyoi'),
          tournament_id: otherSaikyoi,
        })}`,
      );
      await sql`
        update tournaments set question_set = '同名'
        where id in (${entryFor('saikyoi').tournament_id}, ${otherShinjinou})
      `;
      const sameNameAcrossTypes = await refusalOf(
        sql`insert into entries ${sql({
          ...entryFor('saikyoi'),
          tournament_id: otherShinjinou,
        })}`,
      );

      expect(acrossTypes).toBeUndefined();
      expect(sameType).toBe(PARTICIPANT_REGION_SQLSTATE);
      expect(sameNameAcrossTypes).toBe(PARTICIPANT_REGION_SQLSTATE);
    });

    // A name that differs only in spacing would silently count as another
    // question set, letting through what it should refuse.
    // 0044 adds format characters and names not NFKC-normalized: both look
    // the same as another name, and would count as another question set.
    it('refuses question set names that would look like another', async () => {
      await seedRegion(false);
      const codes = [];
      for (const name of [
        '宮崎　',
        ' 宮崎',
        '宮 崎',
        '',
        '宮崎\u200b',
        '\ufeff宮崎',
        '宮崎Ａ',
        'ﾐﾔｻﾞｷ',
      ]) {
        codes.push(
          await refusalOf(sql`
            update tournaments set question_set = ${name}
            where region_id = (select id from regions where slug = ${testRegionSlug})
          `),
        );
      }

      expect(codes).toEqual(Array(8).fill('23514'));
      // The form the admin screen stores is accepted.
      expect(
        await refusalOf(sql`
          update tournaments set question_set = '宮崎A'
          where region_id = (select id from regions where slug = ${testRegionSlug})
        `),
      ).toBeUndefined();
    });

    // Question sets only decide entries across regions: where a region
    // allows one of its tournaments only, different question sets for its
    // 最強位 and 新人王 still don't let a participant enter both.
    it('refuses both of a region without dual entry, whatever their question sets', async () => {
      const {entryFor} = await seedRegion(false);
      await sql`
        update tournaments set question_set = '最強位用'
        where id = ${entryFor('saikyoi').tournament_id}
      `;
      await sql`
        update tournaments set question_set = '新人王用'
        where id = ${entryFor('shinjinou').tournament_id}
      `;
      await sql`insert into entries ${sql(entryFor('saikyoi'))}`;

      const code = await refusalOf(
        sql`insert into entries ${sql(entryFor('shinjinou'))}`,
      );

      expect(code).toBe(REGION_DUAL_ENTRY_SQLSTATE);
    });

    it('claims a region by tournament, refusing only the same question set', async () => {
      const {participantId, entryFor} = await seedRegion(false);
      await sql`insert into entries ${sql(entryFor('saikyoi'))}`;
      const sameSetTournamentId = await seedOtherRegionTournament('claim-same');
      const ownSetTournamentId = await seedOtherRegionTournament(
        'claim-own',
        '鹿児島',
      );
      const claim = async (tournamentId: string) => {
        const [row] = await sql`
          select claim_participant_region_for_tournament(
            ${participantId}, ${tournamentId}
          ) as claimed
        `;
        return row.claimed as boolean;
      };

      const sameSet = await claim(sameSetTournamentId);
      const ownSet = await claim(ownSetTournamentId);
      const [{region_id: regionId}] = await sql`
        select region_id from participants where id = ${participantId}
      `;
      const [{region_id: ownSetRegionId}] = await sql`
        select region_id from tournaments where id = ${ownSetTournamentId}
      `;

      expect(sameSet).toBe(false);
      expect(ownSet).toBe(true);
      expect(regionId).toBe(ownSetRegionId);
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

    // `claim_participant_region_for_tournament()` and `check_entry_seat()`
    // take the participant row in turn, which is all that keeps these two apart.
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
              select claim_participant_region_for_tournament(
                ${participantId}, ${otherTournament.id}
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
      expect(
        [...refusals].filter(code => code !== PARTICIPANT_REGION_SQLSTATE),
      ).toEqual([]);
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
    // through the check again (see the lock test above for why).
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

// 0045: a region allowing dual entry can't have its 最強位 and 新人王 on the
// same question set, whichever of the region or the tournaments changes.
describe.skipIf(!dbReachable)(
  'question sets of a region allowing dual entry (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const regionSlug = 'db-schema-dual-question-set-test-region';

    async function cleanup() {
      await sql`delete from tournaments where region_id in (
        select id from regions where slug = ${regionSlug}
      )`;
      await sql`delete from regions where slug = ${regionSlug}`;
    }

    beforeEach(cleanup);

    afterAll(async () => {
      await cleanup();
      await sql.close();
    });

    /**
     * Creates the region with both of its tournaments.
     * @param allowsDualEntry The region's dual-entry setting.
     * @param saikyoi The 最強位's question set.
     * @param shinjinou The 新人王's question set.
     */
    async function seed(
      allowsDualEntry: boolean,
      saikyoi: string | null,
      shinjinou: string | null,
    ) {
      const [region] = await sql`
        insert into regions (slug, name, allows_dual_entry)
        values (${regionSlug}, '問題セット確認', ${allowsDualEntry})
        returning id
      `;
      const insert = async (type: string, questionSet: string | null) => {
        const [row] = await sql`
          insert into tournaments (
            region_id, type, name, entry_opens_at, entry_closes_at, question_set
          ) values (
            ${region.id}, ${type}, ${type}, now() - interval '1 day', now(), ${questionSet}
          )
          returning id
        `;
        return row.id as string;
      };
      return {
        regionId: region.id as string,
        saikyoiId: await insert('saikyoi', saikyoi),
        shinjinouId: await insert('shinjinou', shinjinou),
      };
    }

    async function refusalOf(query: PromiseLike<unknown>) {
      try {
        await query;
        return undefined;
      } catch (e: unknown) {
        const {errno} = e as {errno?: string};
        if (!errno) {
          throw e;
        }
        return errno;
      }
    }

    it('refuses giving one tournament the question set of the other', async () => {
      const {shinjinouId} = await seed(true, '宮崎', null);

      const code = await refusalOf(sql`
        update tournaments set question_set = '宮崎' where id = ${shinjinouId}
      `);

      expect(code).toBe(DUAL_ENTRY_SHARED_QUESTION_SET_SQLSTATE);
    });

    it('refuses creating a tournament on the question set of the other', async () => {
      const {regionId, shinjinouId} = await seed(true, '宮崎', null);
      await sql`delete from tournaments where id = ${shinjinouId}`;

      const code = await refusalOf(sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at, question_set
        ) values (
          ${regionId}, 'shinjinou', '新人王', now() - interval '1 day', now(), '宮崎'
        )
      `);

      expect(code).toBe(DUAL_ENTRY_SHARED_QUESTION_SET_SQLSTATE);
    });

    it('accepts different question sets, and the common questions for both', async () => {
      const {saikyoiId, shinjinouId} = await seed(true, null, null);

      const different = await refusalOf(sql`
        update tournaments set question_set = '宮崎最強位' where id = ${saikyoiId}
      `);
      const alsoDifferent = await refusalOf(sql`
        update tournaments set question_set = '宮崎新人王' where id = ${shinjinouId}
      `);

      expect(different).toBeUndefined();
      expect(alsoDifferent).toBeUndefined();
    });

    it('leaves a region without dual entry free to share a question set', async () => {
      const {shinjinouId} = await seed(false, '宮崎', null);

      const code = await refusalOf(sql`
        update tournaments set question_set = '宮崎' where id = ${shinjinouId}
      `);

      expect(code).toBeUndefined();
    });

    it('refuses allowing dual entry while both share a question set', async () => {
      const {regionId} = await seed(false, '宮崎', '宮崎');

      const code = await refusalOf(sql`
        update regions set allows_dual_entry = true where id = ${regionId}
      `);
      // Renaming the region is no change to the rule, and goes through.
      const renamed = await refusalOf(sql`
        update regions set name = '改名' where id = ${regionId}
      `);

      expect(code).toBe(DUAL_ENTRY_SHARED_QUESTION_SET_SQLSTATE);
      expect(renamed).toBeUndefined();
    });

    it('compares named sets by name and the common questions within a type', async () => {
      const [row] = await sql`
        select
          same_question_set('A', 'saikyoi', 'A', 'shinjinou') as named_across,
          same_question_set('A', 'saikyoi', 'B', 'saikyoi') as named_differ,
          same_question_set(null, 'saikyoi', null, 'saikyoi') as common_same,
          same_question_set(null, 'saikyoi', null, 'shinjinou') as common_across,
          same_question_set('A', 'saikyoi', null, 'saikyoi') as named_common
      `;

      expect(row).toEqual({
        named_across: true,
        named_differ: false,
        common_same: true,
        common_across: false,
        named_common: false,
      });
    });

    // The edit form sends every field on each save: a save that changes
    // neither the question set nor the region must not wait on the region.
    it('takes the region row only when the question set or the region changes', async () => {
      const {regionId, saikyoiId} = await seed(true, '宮崎', null);
      const holder = await sql.reserve();
      const writer = await sql.reserve();
      try {
        await holder`begin`;
        await holder`select 1 from regions where id = ${regionId} for no key update`;
        await writer`set lock_timeout = '500ms'`;

        const renamed = await refusalOf(writer`
          update tournaments set name = '改名', question_set = '宮崎'
          where id = ${saikyoiId}
        `);
        const changed = await refusalOf(writer`
          update tournaments set question_set = '宮崎2' where id = ${saikyoiId}
        `);

        expect(renamed).toBeUndefined();
        // 55P03: lock_not_available, i.e. it did wait on the region row.
        expect(changed).toBe('55P03');
      } finally {
        await holder`rollback`;
        await writer`set lock_timeout = 0`;
        holder.release();
        writer.release();
      }
    });

    it('leaves a region that does not exist to the foreign key', async () => {
      const code = await refusalOf(sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at, question_set
        ) values (
          '00000000-0000-0000-0000-0000000000ff', 'saikyoi', '存在しない地域',
          now() - interval '1 day', now(), '宮崎'
        )
      `);

      expect(code).toBe('23503');
    });

    // Both triggers take the region row before reading the other side, so
    // two changes that are each fine alone can't both commit.
    it('never lets concurrent changes leave both on one question set', async () => {
      const other = new SQL(DB_URL);
      const shared: boolean[] = [];
      for (let round = 0; round < 10; round++) {
        await cleanup();
        const {regionId, saikyoiId, shinjinouId} = await seed(
          round % 2 === 0,
          null,
          null,
        );
        const ignore = () => {};
        await Promise.all([
          sql`update tournaments set question_set = '同時' where id = ${saikyoiId}`.then(
            ignore,
            ignore,
          ),
          other`update tournaments set question_set = '同時' where id = ${shinjinouId}`.then(
            ignore,
            ignore,
          ),
          other`update regions set allows_dual_entry = true where id = ${regionId}`.then(
            ignore,
            ignore,
          ),
        ]);
        const [row] = await sql`
          select r.allows_dual_entry and count(*) filter (
            where t.question_set = '同時'
          ) = 2 as shared
          from regions r join tournaments t on t.region_id = r.id
          where r.id = ${regionId}
          group by r.allows_dual_entry
        `;
        shared.push(row.shared as boolean);
      }
      await other.close();

      expect(shared.every(value => !value)).toBe(true);
    });
  },
);

// 0050, #284: a tournament's entries were accepted under the dual-entry
// checks of its region and type, so neither may change while it has any.
describe.skipIf(!dbReachable)(
  'region and type of a tournament with entries (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const regionSlug = 'db-schema-region-type-lock-test-region';
    const emailDomain = 'db-schema-region-type-lock-test.example.com';

    async function cleanup() {
      const slugs = [regionSlug, `${regionSlug}-other`];
      await sql`delete from entries where tournament_id in (
        select t.id from tournaments t join regions r on r.id = t.region_id
        where r.slug in ${sql(slugs)}
      )`;
      await sql`delete from participants where email like ${'%@' + emailDomain}`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug in ${sql(slugs)}
      )`;
      await sql`delete from regions where slug in ${sql(slugs)}`;
    }

    beforeEach(cleanup);

    afterAll(async () => {
      await cleanup();
      await sql.close();
    });

    /** A region with a 最強位, a participant of that region, and another region. */
    async function seed() {
      const [region] = await sql`
        insert into regions (slug, name) values (${regionSlug}, '移動元')
        returning id
      `;
      const [other] = await sql`
        insert into regions (slug, name) values (${`${regionSlug}-other`}, '移動先')
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at
        ) values (
          ${region.id}, 'saikyoi', 'テスト大会', '2020-01-01T00:00:00Z',
          '2099-01-01T00:00:00Z'
        )
        returning id
      `;
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (${region.id}, ${`p-${crypto.randomUUID()}@${emailDomain}`}, 'x')
        returning id
      `;
      return {
        regionId: region.id as string,
        otherRegionId: other.id as string,
        tournamentId: tournament.id as string,
        participantId: participant.id as string,
      };
    }

    function insertEntry(
      db: SQL,
      tournamentId: string,
      participantId: string,
      status = 'pending_verification',
    ) {
      return db`
        insert into entries (
          participant_id, tournament_id, name, furigana, display_name, status
        ) values (
          ${participantId}, ${tournamentId}, '山田太郎', 'ヤマダタロウ', '太郎',
          ${status}
        )
      `;
    }

    async function refusalOf(query: PromiseLike<unknown>) {
      try {
        await query;
        return undefined;
      } catch (e: unknown) {
        const {errno} = e as {errno?: string};
        if (!errno) {
          throw e;
        }
        return errno;
      }
    }

    it('refuses changing the region or type once there is an entry, cancelled or not', async () => {
      const {otherRegionId, tournamentId, participantId} = await seed();
      await insertEntry(sql, tournamentId, participantId, 'cancelled');

      const moved = await refusalOf(sql`
        update tournaments set region_id = ${otherRegionId}
        where id = ${tournamentId}
      `);
      const retyped = await refusalOf(sql`
        update tournaments set type = 'shinjinou' where id = ${tournamentId}
      `);

      expect(moved).toBe(TOURNAMENT_REGION_TYPE_LOCKED_SQLSTATE);
      expect(retyped).toBe(TOURNAMENT_REGION_TYPE_LOCKED_SQLSTATE);
    });

    it('lets the same region and type be written back, and anything else change', async () => {
      const {regionId, tournamentId, participantId} = await seed();
      await insertEntry(sql, tournamentId, participantId);

      const code = await refusalOf(sql`
        update tournaments
        set region_id = ${regionId}, type = 'saikyoi', name = '改名',
          capacity = 10
        where id = ${tournamentId}
      `);

      expect(code).toBeUndefined();
    });

    it('lets a tournament without entries move', async () => {
      const {otherRegionId, tournamentId} = await seed();

      const code = await refusalOf(sql`
        update tournaments set region_id = ${otherRegionId}, type = 'shinjinou'
        where id = ${tournamentId}
      `);

      expect(code).toBeUndefined();
    });

    // The move waits on the tournament row an uncommitted entry holds for
    // its foreign key, and then sees that entry.
    it('sees an entry committed while the move waited for the tournament row', async () => {
      const {otherRegionId, tournamentId, participantId} = await seed();
      const holder = await sql.reserve();
      const mover = new SQL(DB_URL);
      try {
        await holder`begin`;
        await insertEntry(holder, tournamentId, participantId);
        const move = refusalOf(mover`
          update tournaments set region_id = ${otherRegionId}
          where id = ${tournamentId}
        `);
        // Give the move time to reach the row lock it then waits on.
        await Bun.sleep(200);
        await holder`commit`;

        expect(await move).toBe(TOURNAMENT_REGION_TYPE_LOCKED_SQLSTATE);
      } finally {
        holder.release();
        await mover.close();
      }
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
          now() - interval '1 day', now()
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

    beforeEach(deleteTestRegion);

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
          ${region.id}, 'saikyoi', 'テスト大会', now() - interval '1 day', now()
        )
        returning id
      `;
      return tournament.id as string;
    }

    // 0048, #285: held in the table too, for writes made straight through
    // SQL and for a PATCH that sends one end of the period.
    it('refuses a tournament whose entry period or capacity can never work', async () => {
      const tournamentId = await createTournament();
      const codes = [];
      for (const statement of [
        sql`update tournaments set entry_closes_at = entry_opens_at
            where id = ${tournamentId}`,
        sql`update tournaments
            set entry_closes_at = entry_opens_at - interval '1 second'
            where id = ${tournamentId}`,
        sql`update tournaments set capacity = 0 where id = ${tournamentId}`,
        sql`update tournaments set capacity = -1 where id = ${tournamentId}`,
      ]) {
        try {
          await statement;
          codes.push(undefined);
        } catch (error) {
          codes.push((error as {errno?: string}).errno);
        }
      }

      expect(codes).toEqual(Array(4).fill('23514'));
      // A capacity of 1, or none at all, goes in.
      await sql`update tournaments set capacity = 1 where id = ${tournamentId}`;
      await sql`
        update tournaments set capacity = null where id = ${tournamentId}
      `;
    });

    // 0048 adds both `not valid`, so a tournament stored out of order
    // before it doesn't stop the deploy; 0049 validates them once no such
    // row is left, so the rows already there are held to them as well.
    it('validates the period and capacity checks for the rows already there', async () => {
      const rows = await sql`
        select conname, convalidated from pg_constraint
          where conrelid = 'tournaments'::regclass
            and conname in (
              'tournaments_entry_period_ordered',
              'tournaments_capacity_positive'
            )
          order by conname
      `;

      expect([...rows]).toEqual([
        {conname: 'tournaments_capacity_positive', convalidated: true},
        {conname: 'tournaments_entry_period_ordered', convalidated: true},
      ]);
    });

    it('refuses a new tournament whose entry period or capacity can never work', async () => {
      const [region] = await sql`
        insert into regions (slug, name) values (${testRegionSlug}, 'テスト地域')
        returning id
      `;
      const codes = [];
      for (const [opensAt, closesAt, capacity] of [
        ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', null],
        ['2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z', null],
        ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 0],
      ] as const) {
        try {
          await sql`
            insert into tournaments (
              region_id, type, name, capacity, entry_opens_at, entry_closes_at
            ) values (
              ${region.id}, 'saikyoi', 'テスト大会', ${capacity}, ${opensAt},
              ${closesAt}
            )
          `;
          codes.push(undefined);
        } catch (error) {
          codes.push((error as {errno?: string}).errno);
        }
      }

      expect(codes).toEqual(Array(3).fill('23514'));
    });

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
          ${region.id}, 'saikyoi', 'テスト大会', now() - interval '1 day', now()
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
// backstop for rows written with plain SQL. The migration spells the numbers
// out on purpose; the tests below use the shared constants, so the two copies
// failing to agree is what they catch.
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
          ${region.id}, 'saikyoi', 'テスト大会', now() - interval '1 day', now()
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

    /**
     * Custom field answers that add up to `total` characters, none of them
     * longer than one answer may be: a `note` and an `allergies` checkbox
     * answer taking the rest.
     * @param total The combined length wanted.
     */
    function customFieldValuesOfLength(
      total: number,
    ): Record<string, string | string[]> {
      const allergies: string[] = [];
      for (
        let left = total - CUSTOM_FIELD_VALUE_MAX_LENGTH;
        left > 0;
        left -= CUSTOM_FIELD_VALUE_MAX_LENGTH
      ) {
        allergies.push(
          'あ'.repeat(Math.min(left, CUSTOM_FIELD_VALUE_MAX_LENGTH)),
        );
      }
      return {note: 'あ'.repeat(CUSTOM_FIELD_VALUE_MAX_LENGTH), allergies};
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
          display_name: 'あ'.repeat(ENTRY_NAME_MAX_LENGTH),
          free_text: 'あ'.repeat(ENTRY_FREE_TEXT_MAX_LENGTH),
        },
        customFieldValuesOfLength(CUSTOM_FIELD_VALUES_TOTAL_MAX_LENGTH),
      );

      expect(errno).toBeUndefined();
    });

    it('entries rejects an over-long display_name', async () => {
      const entry = await seedEntry();

      const errno = await insertError({
        ...entry,
        display_name: 'あ'.repeat(ENTRY_NAME_MAX_LENGTH + 1),
      });

      // check_violation
      expect(errno).toBe('23514');
    });

    it('entries rejects custom field answers over the combined maximum', async () => {
      const entry = await seedEntry();

      const errno = await insertError(
        entry,
        customFieldValuesOfLength(CUSTOM_FIELD_VALUES_TOTAL_MAX_LENGTH + 1),
      );

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

      expect(code).toBe(STAFF_ACCOUNT_DISABLED_SQLSTATE);
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
        ) values (${region.id}, 'saikyoi', 'テスト大会', now() - interval '1 day', now())
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
