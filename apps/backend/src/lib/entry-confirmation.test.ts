import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'bun:test';
import {createDbClient} from './db';
import {SQL} from 'bun';
import {COMMON_ERROR_CODES} from '@regional-quiz/shared';
import {confirmEntryByToken} from './entry-confirmation';
import {generateToken} from './token';
import {testBindings} from '../test-support/bindings';
import {
  DB_URL,
  isDbReachable,
  SUPABASE_SECRET_KEY,
  SUPABASE_URL,
} from '../test-support/db';
import {
  createEntryRow,
  createTournamentAndRegulation,
  createVerificationToken,
  deleteTestRegionRows,
  type EntryRowStatus,
  type TournamentFixture,
} from '../test-support/db-fixtures';

const env = testBindings({
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
});

describe.skipIf(!(await isDbReachable()))(
  'confirmEntryByToken (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'entry-confirmation-test-region';
    const testEmailDomain = 'entry-confirmation-test.example.com';
    const originalFetch = globalThis.fetch;
    // The addresses a queued confirmation's promotion mailed, in order.
    let mailedTo: string[] = [];

    beforeAll(() => {
      // The Supabase client also runs on `fetch`, so only intercept the
      // outbound Resend call and pass everything else through untouched.
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('https://api.resend.com/')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as {
            to?: string | string[];
          };
          mailedTo.push(...[body.to ?? []].flat());
          return new Response(null, {status: 200});
        }
        return originalFetch(input, init);
      }) as typeof fetch;
    });

    beforeEach(() => {
      mailedTo = [];
    });

    afterAll(async () => {
      globalThis.fetch = originalFetch;
      await deleteTestRegionRows(sql, testRegionSlug, testEmailDomain);
      await sql.close();
    });

    async function createFixture(
      suffix: string,
      capacity: number | null,
    ): Promise<TournamentFixture> {
      return createTournamentAndRegulation(sql, `${testRegionSlug}-${suffix}`, {
        capacity,
      });
    }

    async function createEntryFixture(
      fixture: TournamentFixture,
      status: EntryRowStatus = 'pending_verification',
    ): Promise<string> {
      const {entryId} = await createEntryRow(sql, fixture, testEmailDomain, {
        status,
      });
      return entryId;
    }

    async function emailOf(entryId: string): Promise<string> {
      const [row] = await sql`
        select p.email from entries e
        join participants p on p.id = e.participant_id
        where e.id = ${entryId}
      `;
      return row.email as string;
    }

    it('confirms a valid, unused token', async () => {
      const fixture = await createFixture('confirm', null);
      const entryId = await createEntryFixture(fixture);
      const token = await createVerificationToken(sql, entryId);

      const result = await confirmEntryByToken(env, createDbClient(env), token);

      expect(result).toEqual({
        ok: true,
        entryStatus: 'confirmed',
        // What the frontend needs to drop the list from its cache (#125).
        tournament: {regionSlug: `${testRegionSlug}-confirm`, type: 'saikyoi'},
      });
      const [entryRow] = await sql`
        select status, email_verified_at from entries where id = ${entryId}
      `;
      expect(entryRow.status).toBe('confirmed');
      expect(entryRow.email_verified_at).not.toBeNull();
    });

    // Following the link proves the address, and the link belongs to a
    // submission made with the account's current password and region (#189).
    it('marks the participant verified, keeping the first verification time', async () => {
      const fixture = await createFixture('verify-account', null);
      const entryId = await createEntryFixture(fixture);
      const [{participant_id: participantId}] = await sql`
        select participant_id from entries where id = ${entryId}
      `;
      const [before] = await sql`
        select email_verified_at from participants where id = ${participantId}
      `;
      expect(before.email_verified_at).toBeNull();

      expect(
        await confirmEntryByToken(
          env,
          createDbClient(env),
          await createVerificationToken(sql, entryId),
        ),
      ).toMatchObject({ok: true});

      const [after] = await sql`
        select email_verified_at from participants where id = ${participantId}
      `;
      expect(after.email_verified_at).not.toBeNull();

      // A later confirmation of another entry leaves the original time alone.
      // The other region uses questions of its own, so the first entry, now
      // confirmed, doesn't rule it out (0043).
      const otherFixture = await createFixture('verify-account-again', null);
      await sql`
        update tournaments set question_set = '独自'
        where id = ${otherFixture.tournamentId}
      `;
      const [otherEntry] = await sql`
        insert into entries (
          participant_id, tournament_id, name, furigana, display_name
        ) values (
          ${participantId}, ${otherFixture.tournamentId}, '山田太郎',
          'ヤマダタロウ', '太郎'
        )
        returning id
      `;
      expect(
        await confirmEntryByToken(
          env,
          createDbClient(env),
          await createVerificationToken(sql, otherEntry.id),
        ),
      ).toMatchObject({ok: true});
      const [later] = await sql`
        select email_verified_at from participants where id = ${participantId}
      `;
      expect(later.email_verified_at).toEqual(after.email_verified_at);
    });

    it('leaves the participant unverified when the token is refused', async () => {
      const fixture = await createFixture('verify-account-refused', null);
      const entryId = await createEntryFixture(fixture);
      const token = await createVerificationToken(sql, entryId, {
        expiresAt: '2020-01-01T00:00:00Z',
      });

      expect(
        await confirmEntryByToken(env, createDbClient(env), token),
      ).toMatchObject({ok: false});

      const [participant] = await sql`
        select p.email_verified_at from participants p
        join entries e on e.participant_id = p.id
        where e.id = ${entryId}
      `;
      expect(participant.email_verified_at).toBeNull();
    });

    it('waitlists an entry when capacity is full', async () => {
      const fixture = await createFixture('capacity', 1);
      await createEntryFixture(fixture, 'confirmed');
      const entryId = await createEntryFixture(fixture);
      const token = await createVerificationToken(sql, entryId);

      const result = await confirmEntryByToken(env, createDbClient(env), token);

      expect(result).toEqual({
        ok: true,
        entryStatus: 'waitlisted',
        tournament: {
          regionSlug: `${testRegionSlug}-capacity`,
          type: 'saikyoi',
        },
      });
      const [entryRow] = await sql`
        select status, waitlist_position from entries where id = ${entryId}
      `;
      expect(entryRow.status).toBe('waitlisted');
      expect(entryRow.waitlist_position).toBe(1);
      // The promotion that follows a queued confirmation found no seat.
      expect(mailedTo).toEqual([]);
    });

    // A seat that came free while others wait is theirs: the cancellation
    // that freed it commits before `promote_waitlisted_entries` runs, and a
    // confirmation in between must not take it (#283). Nor may the seat stay
    // empty -- one a failed promotion left, say -- so the confirmation runs
    // the promotion itself.
    it('queues behind the waitlist and promotes its head into a free seat', async () => {
      const fixture = await createFixture('queue-first', 1);
      const {entryId: waiting} = await createEntryRow(
        sql,
        fixture,
        testEmailDomain,
        {status: 'waitlisted', waitlistPosition: 1},
      );
      const entryId = await createEntryFixture(fixture);

      const result = await confirmEntryByToken(
        env,
        createDbClient(env),
        await createVerificationToken(sql, entryId),
      );

      expect(result).toMatchObject({ok: true, entryStatus: 'waitlisted'});
      const rows = await sql`
        select id, status, waitlist_position from entries
        where tournament_id = ${fixture.tournamentId}
        order by status, waitlist_position
      `;
      expect(rows).toEqual([
        {id: waiting, status: 'confirmed', waitlist_position: null},
        {id: entryId, status: 'waitlisted', waitlist_position: 1},
      ]);
      expect(mailedTo).toEqual([await emailOf(waiting)]);
    });

    // When the free seats reach past the queue, the entry just queued is
    // promoted as well. Its participant is on the page this answers, so it
    // reads `confirmed` there and gets no promotion mail of its own.
    it('confirms the queued entry too when the free seats reach it', async () => {
      const fixture = await createFixture('queue-reached', 2);
      const {entryId: waiting} = await createEntryRow(
        sql,
        fixture,
        testEmailDomain,
        {status: 'waitlisted', waitlistPosition: 1},
      );
      const entryId = await createEntryFixture(fixture);

      expect(
        await confirmEntryByToken(
          env,
          createDbClient(env),
          await createVerificationToken(sql, entryId),
        ),
      ).toMatchObject({ok: true, entryStatus: 'confirmed'});
      const rows = await sql`
        select status, waitlist_position from entries
        where tournament_id = ${fixture.tournamentId}
      `;
      expect(rows).toEqual([
        {status: 'confirmed', waitlist_position: null},
        {status: 'confirmed', waitlist_position: null},
      ]);
      expect(mailedTo).toEqual([await emailOf(waiting)]);
    });

    // Without a capacity a waitlist is left only by a failed promotion after
    // the capacity was cleared. The queue still goes first, and then
    // everyone on it -- the newcomer included -- is confirmed rather than
    // left queuing for a seat that is never short.
    it('confirms everyone waiting, and the newcomer, without a capacity', async () => {
      const fixture = await createFixture('queue-first-unlimited', null);
      const {entryId: waiting} = await createEntryRow(
        sql,
        fixture,
        testEmailDomain,
        {status: 'waitlisted', waitlistPosition: 1},
      );
      const entryId = await createEntryFixture(fixture);

      expect(
        await confirmEntryByToken(
          env,
          createDbClient(env),
          await createVerificationToken(sql, entryId),
        ),
      ).toMatchObject({ok: true, entryStatus: 'confirmed'});
      const [waitingRow, entryRow] = await Promise.all(
        [waiting, entryId].map(async id => {
          const [row] = await sql`
            select status, waitlist_position from entries where id = ${id}
          `;
          return row;
        }),
      );
      expect(waitingRow).toEqual({
        status: 'confirmed',
        waitlist_position: null,
      });
      expect(entryRow).toEqual({status: 'confirmed', waitlist_position: null});
      expect(mailedTo).toEqual([await emailOf(waiting)]);
    });

    it('confirms into a free seat when nobody is waiting', async () => {
      const fixture = await createFixture('free-seat', 2);
      await createEntryFixture(fixture, 'confirmed');
      // Cancelled entries leave no one in the queue.
      await createEntryFixture(fixture, 'cancelled');
      const entryId = await createEntryFixture(fixture);

      expect(
        await confirmEntryByToken(
          env,
          createDbClient(env),
          await createVerificationToken(sql, entryId),
        ),
      ).toMatchObject({ok: true, entryStatus: 'confirmed'});
      expect(mailedTo).toEqual([]);
    });

    it('rejects an expired token', async () => {
      const fixture = await createFixture('expired', null);
      const entryId = await createEntryFixture(fixture);
      const token = await createVerificationToken(sql, entryId, {
        expiresAt: '2020-01-01T00:00:00Z',
      });

      const result = await confirmEntryByToken(env, createDbClient(env), token);

      expect(result).toEqual({
        ok: false,
        status: 400,
        error: COMMON_ERROR_CODES.INVALID_OR_EXPIRED_TOKEN,
      });
    });

    it('rejects an already-used token', async () => {
      const fixture = await createFixture('used', null);
      const entryId = await createEntryFixture(fixture);
      const token = await createVerificationToken(sql, entryId, {used: true});

      const result = await confirmEntryByToken(env, createDbClient(env), token);

      expect(result).toEqual({
        ok: false,
        status: 400,
        error: COMMON_ERROR_CODES.INVALID_OR_EXPIRED_TOKEN,
      });
    });

    it('rejects a valid token whose entry is no longer pending', async () => {
      const fixture = await createFixture('cancelled', null);
      const entryId = await createEntryFixture(fixture, 'cancelled');
      // A token a re-entry inserted while the cancellation was running: the
      // cancellation never saw it, so it is still unused and unexpired.
      const token = await createVerificationToken(sql, entryId);

      const result = await confirmEntryByToken(env, createDbClient(env), token);

      expect(result).toEqual({
        ok: false,
        status: 400,
        error: COMMON_ERROR_CODES.INVALID_OR_EXPIRED_TOKEN,
      });
      const [entryRow] = await sql`
        select status from entries where id = ${entryId}
      `;
      expect(entryRow.status).toBe('cancelled');
    });

    it('rejects an unknown token', async () => {
      const result = await confirmEntryByToken(
        env,
        createDbClient(env),
        generateToken(),
      );

      expect(result).toEqual({
        ok: false,
        status: 400,
        error: COMMON_ERROR_CODES.INVALID_OR_EXPIRED_TOKEN,
      });
    });
  },
);
