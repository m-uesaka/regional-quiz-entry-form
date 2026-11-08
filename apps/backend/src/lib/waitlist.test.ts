import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import {confirmEntryByToken} from './entry-confirmation';
import {promoteWaitlistedEntries} from './waitlist';
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
  type TournamentFixture,
} from '../test-support/db-fixtures';

const env = testBindings({
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
});

describe.skipIf(!(await isDbReachable()))(
  'promoteWaitlistedEntries (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'waitlist-lib-test-region';
    const testEmailDomain = 'waitlist-lib-test.example.com';
    const originalFetch = globalThis.fetch;
    // The addresses the stub below was asked to mail, in order, and whether
    // it should refuse them.
    let mailedTo: string[] = [];
    let mailFails = false;

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
          return new Response(null, {status: mailFails ? 500 : 200});
        }
        return originalFetch(input, init);
      }) as typeof fetch;
    });

    afterAll(async () => {
      globalThis.fetch = originalFetch;
      await deleteTestRegionRows(sql, testRegionSlug, testEmailDomain);
      await sql.close();
    });

    // Capacity 1, so one confirmed entry fills the tournament.
    async function createFixture(suffix: string): Promise<TournamentFixture> {
      return createTournamentAndRegulation(sql, `${testRegionSlug}-${suffix}`, {
        capacity: 1,
      });
    }

    async function createWaitlistedEntry(
      fixture: TournamentFixture,
      waitlistPosition: number,
    ): Promise<string> {
      const {entryId} = await createEntryRow(sql, fixture, testEmailDomain, {
        status: 'waitlisted',
        waitlistPosition,
      });
      return entryId;
    }

    async function statusOf(entryId: string) {
      const [row] = await sql`
        select e.status, e.waitlist_position, p.email
        from entries e join participants p on p.id = e.participant_id
        where e.id = ${entryId}
      `;
      return row as {
        status: string;
        waitlist_position: number | null;
        email: string;
      };
    }

    async function createConfirmedEntry(
      fixture: TournamentFixture,
    ): Promise<void> {
      const id = await createWaitlistedEntry(fixture, 0);
      await sql`
        update entries set status = 'confirmed', waitlist_position = null
        where id = ${id}
      `;
    }

    // A cancellation frees the one seat (the fixture's capacity is 1).
    it('promotes the entry with the smallest waitlist_position', async () => {
      const fixture = await createFixture('promote');
      const second = await createWaitlistedEntry(fixture, 2);
      const first = await createWaitlistedEntry(fixture, 1);

      await promoteWaitlistedEntries(env, fixture.tournamentId);

      const [firstRow] = await sql`
        select status, waitlist_position from entries where id = ${first}
      `;
      const [secondRow] = await sql`
        select status, waitlist_position from entries where id = ${second}
      `;
      expect(firstRow.status).toBe('confirmed');
      expect(firstRow.waitlist_position).toBeNull();
      expect(secondRow.status).toBe('waitlisted');
      // Moved up to the front rather than left behind a gap.
      expect(secondRow.waitlist_position).toBe(1);
    });

    it('promotes nobody when the tournament is already at capacity', async () => {
      // The fixture's capacity is 1, so a single confirmed entry means the
      // seat this promotion was triggered for has already been taken by a
      // concurrent confirmation.
      const fixture = await createFixture('at-capacity');
      const waitlisted = await createWaitlistedEntry(fixture, 1);
      await sql`
        update entries set status = 'confirmed', waitlist_position = null
        where id = ${await createWaitlistedEntry(fixture, 2)}
      `;

      await promoteWaitlistedEntries(env, fixture.tournamentId);

      const [waitlistedRow] = await sql`
        select status, waitlist_position from entries where id = ${waitlisted}
      `;
      expect(waitlistedRow.status).toBe('waitlisted');
      expect(waitlistedRow.waitlist_position).toBe(1);
    });

    it('does nothing when there is no waitlisted entry', async () => {
      const fixture = await createFixture('empty');

      await expect(
        promoteWaitlistedEntries(env, fixture.tournamentId),
      ).resolves.toEqual({promotedCount: 0, mailFailedCount: 0});
    });

    // The cancellation commits before the promotion runs (`cancelOwnEntry()`
    // makes them two RPCs), and a newcomer who follows their verification
    // link in between used to take the freed seat ahead of the waitlist
    // (#283). Now the newcomer queues, and their confirmation promotes the
    // head into the seat; the cancellation's own promotion finds it taken.
    it('keeps a confirmation between a cancellation and its promotion behind the waitlist', async () => {
      const f = await createFixture('overtake');
      const cancelling = await createEntryRow(sql, f, testEmailDomain, {
        status: 'confirmed',
      });
      const waiting = await createWaitlistedEntry(f, 1);
      const {entryId: newcomer} = await createEntryRow(sql, f, testEmailDomain);
      const token = await createVerificationToken(sql, newcomer);

      // The cancellation alone, as committed before the promotion's RPC.
      const [cancelled] = await sql`
        select previous_status from cancel_own_entry(
          ${cancelling.entryId}, ${cancelling.participantId}
        )
      `;
      expect(cancelled.previous_status).toBe('confirmed');
      mailedTo = [];
      expect(await confirmEntryByToken(env, token)).toMatchObject({
        ok: true,
        entryStatus: 'waitlisted',
      });

      const [waitingRow, newcomerRow] = await Promise.all(
        [waiting, newcomer].map(statusOf),
      );
      expect(waitingRow).toMatchObject({
        status: 'confirmed',
        waitlist_position: null,
      });
      expect(newcomerRow).toMatchObject({
        status: 'waitlisted',
        waitlist_position: 1,
      });
      expect(mailedTo).toEqual([waitingRow.email]);

      // The cancellation's promotion, arriving late, has no seat left.
      mailedTo = [];
      expect(await promoteWaitlistedEntries(env, f.tournamentId)).toEqual({
        promotedCount: 0,
        mailFailedCount: 0,
      });
      expect((await statusOf(newcomer)).status).toBe('waitlisted');
      expect(mailedTo).toEqual([]);
    });

    // A promotion that failed leaves the seat empty; the next confirmation
    // queues up instead of skipping the line, and fills the seat in order
    // with the promotion it runs, rather than leaving it empty until the
    // next cancellation or capacity save.
    it('fills a seat a failed promotion left empty on the next confirmation', async () => {
      const f = await createFixture('missed-promotion');
      const waiting = await createWaitlistedEntry(f, 1);
      const {entryId: newcomer} = await createEntryRow(sql, f, testEmailDomain);
      const token = await createVerificationToken(sql, newcomer);
      mailedTo = [];

      expect(await confirmEntryByToken(env, token)).toMatchObject({
        ok: true,
        entryStatus: 'waitlisted',
      });

      const [waitingRow, newcomerRow] = await Promise.all(
        [waiting, newcomer].map(statusOf),
      );
      expect(waitingRow).toMatchObject({
        status: 'confirmed',
        waitlist_position: null,
      });
      expect(newcomerRow).toMatchObject({
        status: 'waitlisted',
        waitlist_position: 1,
      });
      // Only the promoted participant: the newcomer was told by the page.
      expect(mailedTo).toEqual([waitingRow.email]);

      // Nothing is left for a later promotion to do.
      mailedTo = [];
      expect(await promoteWaitlistedEntries(env, f.tournamentId)).toEqual({
        promotedCount: 0,
        mailFailedCount: 0,
      });
      expect(mailedTo).toEqual([]);
    });

    describe('promoteWaitlistedEntries', () => {
      it('fills the seats a raised capacity freed, in waitlist order', async () => {
        const f = await createFixture('raise');
        await createConfirmedEntry(f);
        const waiting = [];
        for (const position of [3, 1, 2]) {
          waiting.push(await createWaitlistedEntry(f, position));
        }
        await sql`update tournaments set capacity = 3 where id = ${f.tournamentId}`;
        mailedTo = [];

        const promoted = await promoteWaitlistedEntries(env, f.tournamentId);

        // 3 seats, 1 taken: positions 1 and 2 go up, and position
        // 3 waits at the head of the line, renumbered from 1 (0037).
        expect(promoted).toEqual({promotedCount: 2, mailFailedCount: 0});
        const [third, first, second] = await Promise.all(waiting.map(statusOf));
        expect(first.status).toBe('confirmed');
        expect(second.status).toBe('confirmed');
        expect(first.waitlist_position).toBeNull();
        expect(third).toMatchObject({
          status: 'waitlisted',
          waitlist_position: 1,
        });
        expect(mailedTo).toEqual([first.email, second.email]);
      });

      it('promotes everyone waiting when the capacity is cleared', async () => {
        const f = await createFixture('clear');
        await createConfirmedEntry(f);
        const waiting = [
          await createWaitlistedEntry(f, 1),
          await createWaitlistedEntry(f, 2),
        ];
        await sql`update tournaments set capacity = null where id = ${f.tournamentId}`;

        expect(await promoteWaitlistedEntries(env, f.tournamentId)).toEqual({
          promotedCount: 2,
          mailFailedCount: 0,
        });
        for (const id of waiting) {
          expect((await statusOf(id)).status).toBe('confirmed');
        }
      });

      it('promotes nobody when no seat is free', async () => {
        const f = await createFixture('full');
        await createConfirmedEntry(f);
        await createConfirmedEntry(f);
        const waiting = await createWaitlistedEntry(f, 1);
        mailedTo = [];

        // Capacity 1 with 2 confirmed: lowered below what is confirmed.
        expect(await promoteWaitlistedEntries(env, f.tournamentId)).toEqual({
          promotedCount: 0,
          mailFailedCount: 0,
        });
        expect((await statusOf(waiting)).status).toBe('waitlisted');
        expect(mailedTo).toEqual([]);
      });

      // The promotions are committed; a lost mail must not report them as
      // not having happened, but staff need to know who wasn't told.
      it('counts the mails that could not be sent', async () => {
        const f = await createFixture('mailfail');
        const waiting = await createWaitlistedEntry(f, 1);
        mailFails = true;
        const originalConsoleError = console.error;
        console.error = () => {};
        try {
          expect(await promoteWaitlistedEntries(env, f.tournamentId)).toEqual({
            promotedCount: 1,
            mailFailedCount: 1,
          });
        } finally {
          mailFails = false;
          console.error = originalConsoleError;
        }
        expect((await statusOf(waiting)).status).toBe('confirmed');
      });
    });
  },
);
