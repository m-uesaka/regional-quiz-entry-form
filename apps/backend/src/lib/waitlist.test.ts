import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import type {Bindings} from '../types/env';
import {promoteWaitlistedEntries} from './waitlist';
import {hashPassword} from './password';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';

// Local Supabase Postgres connection (`supabase start` default), same
// convention as `lib/db-schema.test.ts`. Skipped automatically when one
// isn't reachable, e.g. in CI.
const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

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

const env: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

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
      await sql`delete from entries where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlug + '%'}
        )
      )`;
      await sql`delete from participants where email like ${'%@' + testEmailDomain}`;
      await sql`delete from regulations where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlug + '%'}
        )
      )`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug like ${testRegionSlug + '%'}
      )`;
      await sql`delete from regions where slug like ${testRegionSlug + '%'}`;
      await sql.close();
    });

    async function createTournamentAndRegulation(
      suffix: string,
    ): Promise<{regionId: string; tournamentId: string; regulationId: string}> {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${testRegionSlug + '-' + suffix}, 'テスト地域')
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, capacity, entry_opens_at, entry_closes_at
        ) values (
          ${region.id}, 'saikyoi', 'テスト大会', 1,
          '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z'
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

    async function createWaitlistedEntry(
      regionId: string,
      tournamentId: string,
      regulationId: string,
      waitlistPosition: number,
    ): Promise<string> {
      const email = `entry-${crypto.randomUUID()}@${testEmailDomain}`;
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (${regionId}, ${email}, ${await hashPassword('quiz-entry-pass1')})
        returning id
      `;
      const [entry] = await sql`
        insert into entries (
          participant_id, tournament_id, name, furigana, display_name,
          status, waitlist_position
        ) values (
          ${participant.id}, ${tournamentId}, '山田太郎', 'ヤマダタロウ', '太郎',
          'waitlisted', ${waitlistPosition}
        )
        returning id
      `;
      await sql`
        insert into entry_regulations (entry_id, regulation_id, tournament_id)
        values (${entry.id}, ${regulationId}, ${tournamentId})
      `;
      return entry.id as string;
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
      regionId: string,
      tournamentId: string,
      regulationId: string,
    ): Promise<void> {
      const id = await createWaitlistedEntry(
        regionId,
        tournamentId,
        regulationId,
        0,
      );
      await sql`
        update entries set status = 'confirmed', waitlist_position = null
        where id = ${id}
      `;
    }

    // A cancellation frees the one seat (the fixture's capacity is 1).
    it('promotes the entry with the smallest waitlist_position', async () => {
      const fixture = await createTournamentAndRegulation('promote');
      const second = await createWaitlistedEntry(
        fixture.regionId,
        fixture.tournamentId,
        fixture.regulationId,
        2,
      );
      const first = await createWaitlistedEntry(
        fixture.regionId,
        fixture.tournamentId,
        fixture.regulationId,
        1,
      );

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
      const fixture = await createTournamentAndRegulation('at-capacity');
      const waitlisted = await createWaitlistedEntry(
        fixture.regionId,
        fixture.tournamentId,
        fixture.regulationId,
        1,
      );
      await sql`
        update entries set status = 'confirmed', waitlist_position = null
        where id = ${await createWaitlistedEntry(
          fixture.regionId,
          fixture.tournamentId,
          fixture.regulationId,
          2,
        )}
      `;

      await promoteWaitlistedEntries(env, fixture.tournamentId);

      const [waitlistedRow] = await sql`
        select status, waitlist_position from entries where id = ${waitlisted}
      `;
      expect(waitlistedRow.status).toBe('waitlisted');
      expect(waitlistedRow.waitlist_position).toBe(1);
    });

    it('does nothing when there is no waitlisted entry', async () => {
      const fixture = await createTournamentAndRegulation('empty');

      await expect(
        promoteWaitlistedEntries(env, fixture.tournamentId),
      ).resolves.toEqual({promotedCount: 0, mailFailedCount: 0});
    });

    describe('promoteWaitlistedEntries', () => {
      it('fills the seats a raised capacity freed, in waitlist order', async () => {
        const f = await createTournamentAndRegulation('raise');
        await createConfirmedEntry(f.regionId, f.tournamentId, f.regulationId);
        const waiting = [];
        for (const position of [3, 1, 2]) {
          waiting.push(
            await createWaitlistedEntry(
              f.regionId,
              f.tournamentId,
              f.regulationId,
              position,
            ),
          );
        }
        await sql`update tournaments set capacity = 3 where id = ${f.tournamentId}`;
        mailedTo = [];

        const promoted = await promoteWaitlistedEntries(env, f.tournamentId);

        // 3 seats, 1 taken: positions 1 and 2 go up, position 3 waits.
        expect(promoted).toEqual({promotedCount: 2, mailFailedCount: 0});
        const [third, first, second] = await Promise.all(waiting.map(statusOf));
        expect(first.status).toBe('confirmed');
        expect(second.status).toBe('confirmed');
        expect(first.waitlist_position).toBeNull();
        expect(third).toMatchObject({
          status: 'waitlisted',
          waitlist_position: 3,
        });
        expect(mailedTo).toEqual([first.email, second.email]);
      });

      it('promotes everyone waiting when the capacity is cleared', async () => {
        const f = await createTournamentAndRegulation('clear');
        await createConfirmedEntry(f.regionId, f.tournamentId, f.regulationId);
        const waiting = [
          await createWaitlistedEntry(
            f.regionId,
            f.tournamentId,
            f.regulationId,
            1,
          ),
          await createWaitlistedEntry(
            f.regionId,
            f.tournamentId,
            f.regulationId,
            2,
          ),
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
        const f = await createTournamentAndRegulation('full');
        await createConfirmedEntry(f.regionId, f.tournamentId, f.regulationId);
        await createConfirmedEntry(f.regionId, f.tournamentId, f.regulationId);
        const waiting = await createWaitlistedEntry(
          f.regionId,
          f.tournamentId,
          f.regulationId,
          1,
        );
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
        const f = await createTournamentAndRegulation('mailfail');
        const waiting = await createWaitlistedEntry(
          f.regionId,
          f.tournamentId,
          f.regulationId,
          1,
        );
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
