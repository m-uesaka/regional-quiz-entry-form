import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import type {Bindings} from '../types/env';
import {promoteNextWaitlistedEntry} from './waitlist';
import {hashPassword} from './password';
import {PERMISSIVE_SECURITY_BINDINGS} from '../test-support/bindings';

// Local Supabase Postgres connection (`supabase start` default), same
// convention as `lib/db-schema.test.ts`. Skipped automatically when one
// isn't reachable, e.g. in CI.
const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
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
  ...PERMISSIVE_SECURITY_BINDINGS,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

describe.skipIf(!(await isDbReachable()))(
  'promoteNextWaitlistedEntry (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'waitlist-lib-test-region';
    const testEmailDomain = 'waitlist-lib-test.example.com';
    const originalFetch = globalThis.fetch;

    beforeAll(() => {
      // The Supabase client also runs on `fetch`, so only intercept the
      // outbound Resend call and pass everything else through untouched.
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('https://api.resend.com/')) {
          return new Response(null, {status: 200});
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
        values (${regionId}, ${email}, ${await hashPassword('password123')})
        returning id
      `;
      const [entry] = await sql`
        insert into entries (
          participant_id, tournament_id, name, furigana, display_name,
          regulation_id, status, waitlist_position
        ) values (
          ${participant.id}, ${tournamentId}, '山田太郎', 'ヤマダタロウ', '太郎',
          ${regulationId}, 'waitlisted', ${waitlistPosition}
        )
        returning id
      `;
      return entry.id as string;
    }

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

      await promoteNextWaitlistedEntry(env, fixture.tournamentId);

      const [firstRow] = await sql`
        select status, waitlist_position from entries where id = ${first}
      `;
      const [secondRow] = await sql`
        select status, waitlist_position from entries where id = ${second}
      `;
      expect(firstRow.status).toBe('confirmed');
      expect(firstRow.waitlist_position).toBeNull();
      expect(secondRow.status).toBe('waitlisted');
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

      await promoteNextWaitlistedEntry(env, fixture.tournamentId);

      const [waitlistedRow] = await sql`
        select status, waitlist_position from entries where id = ${waitlisted}
      `;
      expect(waitlistedRow.status).toBe('waitlisted');
      expect(waitlistedRow.waitlist_position).toBe(1);
    });

    it('does nothing when there is no waitlisted entry', async () => {
      const fixture = await createTournamentAndRegulation('empty');

      await expect(
        promoteNextWaitlistedEntry(env, fixture.tournamentId),
      ).resolves.toBeUndefined();
    });
  },
);
