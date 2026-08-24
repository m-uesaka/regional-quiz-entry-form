import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import type {EntryInput} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import {createEntry} from './entries';
import {hashPassword} from './password';

// Local Supabase Postgres connection (`supabase start` default), same
// convention as `lib/db-schema.test.ts`. Skipped automatically when one
// isn't reachable, e.g. in CI.
const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// Publicly documented local-dev demo key for Supabase CLI's default stack,
// same as `routes/tournaments.test.ts` — not a real credential.
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
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

describe.skipIf(!(await isDbReachable()))(
  'createEntry (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'entries-lib-test-region';
    const testEmailDomain = 'entries-lib-test.example.com';
    const originalFetch = globalThis.fetch;
    let mailSendCount = 0;

    beforeAll(() => {
      // The Supabase client also runs on `fetch`, so only intercept the
      // outbound Resend call and pass everything else through untouched.
      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('https://api.resend.com/')) {
          mailSendCount++;
          return new Response(null, {status: 200});
        }
        return originalFetch(input, init);
      }) as typeof fetch;
    });

    afterAll(async () => {
      globalThis.fetch = originalFetch;
      await sql`delete from email_verification_tokens where entry_id in (
        select id from entries where tournament_id in (
          select id from tournaments where region_id in (
            select id from regions where slug like ${testRegionSlug + '%'}
          )
        )
      )`;
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

    interface TournamentFixture {
      regionId: string;
      tournamentId: string;
      regulationId: string;
    }

    async function createFixture(
      suffix: string,
      options: {
        entryOpensAt?: string;
        entryClosesAt?: string;
        capacity?: number | null;
        priorityStartsAt?: string | null;
        priorityEndsAt?: string | null;
      } = {},
    ): Promise<TournamentFixture> {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${testRegionSlug + '-' + suffix}, 'テスト地域')
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, capacity, entry_opens_at, entry_closes_at
        ) values (
          ${region.id}, 'saikyoi', 'テスト大会',
          ${options.capacity ?? null},
          ${options.entryOpensAt ?? '2020-01-01T00:00:00Z'},
          ${options.entryClosesAt ?? '2099-01-01T00:00:00Z'}
        )
        returning id
      `;
      const [regulation] = await sql`
        insert into regulations (
          tournament_id, label, priority_starts_at, priority_ends_at
        ) values (
          ${tournament.id}, 'テストレギュレーション',
          ${options.priorityStartsAt ?? null},
          ${options.priorityEndsAt ?? null}
        )
        returning id
      `;
      return {
        regionId: region.id as string,
        tournamentId: tournament.id as string,
        regulationId: regulation.id as string,
      };
    }

    function validInput(overrides: Partial<EntryInput> = {}): EntryInput {
      return {
        name: '山田太郎',
        furigana: 'ヤマダタロウ',
        displayName: '太郎',
        email: `entry-${crypto.randomUUID()}@${testEmailDomain}`,
        password: 'password123',
        passwordConfirm: 'password123',
        regulationId: '',
        customFieldValues: {},
        ...overrides,
      };
    }

    it('rejects entry outside the entry period', async () => {
      const fixture = await createFixture('closed', {
        entryOpensAt: '2020-01-01T00:00:00Z',
        entryClosesAt: '2020-01-02T00:00:00Z',
      });

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({regulationId: fixture.regulationId}),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(403);
    });

    it('rejects a non-priority regulation during the priority window', async () => {
      const fixture = await createFixture('priority', {
        priorityStartsAt: '2020-01-01T00:00:00Z',
        priorityEndsAt: '2099-01-01T00:00:00Z',
      });
      const [otherRegulation] = await sql`
        insert into regulations (tournament_id, label)
        values (${fixture.tournamentId}, '対象外レギュレーション')
        returning id
      `;

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({regulationId: otherRegulation.id as string}),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(403);
    });

    it('rejects an email already registered in a different region', async () => {
      const fixtureA = await createFixture('region-a');
      const fixtureB = await createFixture('region-b');
      const email = `entry-${crypto.randomUUID()}@${testEmailDomain}`;
      await sql`
        insert into participants (region_id, email, password_hash)
        values (${fixtureA.regionId}, ${email}, ${await hashPassword('password123')})
      `;

      const result = await createEntry(
        env,
        fixtureB.tournamentId,
        validInput({email, regulationId: fixtureB.regulationId}),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(409);
    });

    it('rejects re-entry under an existing email with the wrong password', async () => {
      const fixture = await createFixture('wrong-password');
      const email = `entry-${crypto.randomUUID()}@${testEmailDomain}`;
      await sql`
        insert into participants (region_id, email, password_hash)
        values (${fixture.regionId}, ${email}, ${await hashPassword('the-real-password')})
      `;

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({
          email,
          password: 'a-wrong-password',
          passwordConfirm: 'a-wrong-password',
          regulationId: fixture.regulationId,
        }),
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.status).toBe(401);
    });

    it('creates a pending_verification entry and sends a verification email', async () => {
      const fixture = await createFixture('success');
      mailSendCount = 0;

      const result = await createEntry(
        env,
        fixture.tournamentId,
        validInput({regulationId: fixture.regulationId}),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [entryRow] = await sql`
        select status from entries where id = ${result.entry.id}
      `;
      expect(entryRow.status).toBe('pending_verification');
      expect(mailSendCount).toBe(1);
    });

    it('rolls back the entry when the verification email fails to send, allowing a retry', async () => {
      const fixture = await createFixture('mail-failure');
      const input = validInput({regulationId: fixture.regulationId});
      const previousFetch = globalThis.fetch;
      globalThis.fetch = (async (
        requestInput: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const url =
          typeof requestInput === 'string'
            ? requestInput
            : requestInput.toString();
        if (url.startsWith('https://api.resend.com/')) {
          return new Response(null, {status: 502});
        }
        return previousFetch(requestInput, init);
      }) as typeof fetch;

      try {
        const failedResult = await createEntry(
          env,
          fixture.tournamentId,
          input,
        );

        expect(failedResult.ok).toBe(false);
        expect(!failedResult.ok && failedResult.status).toBe(500);
        const rows = await sql`
          select id from entries
          where tournament_id = ${fixture.tournamentId}
        `;
        expect(rows.length).toBe(0);
      } finally {
        globalThis.fetch = previousFetch;
      }

      mailSendCount = 0;
      const retryResult = await createEntry(env, fixture.tournamentId, input);

      expect(retryResult.ok).toBe(true);
      expect(mailSendCount).toBe(1);
    });
  },
);
