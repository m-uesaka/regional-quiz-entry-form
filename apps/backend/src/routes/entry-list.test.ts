import {afterAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import type {Bindings} from '../types/env';
import {hashPassword} from '../lib/password';
import app from '../index';

// Local Supabase stack (`supabase start`), same convention as
// `lib/db-schema.test.ts`. Skipped automatically when it isn't reachable,
// e.g. in CI.
const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// Publicly documented local-dev demo key for Supabase CLI's default stack
// (fixed `super-secret-jwt-token-with-at-least-32-characters-long` JWT
// secret) — not a real credential, safe to commit.
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

// This request is rejected by `zValidator()` before any database call, so it
// runs unconditionally (including CI).
describe('GET /tournaments/:tournamentId/entry-list (request validation)', () => {
  it('rejects a non-UUID tournamentId with 400', async () => {
    const res = await app.request(
      '/api/tournaments/not-a-uuid/entry-list',
      {},
      env,
    );

    expect(res.status).toBe(400);
  });
});

describe.skipIf(!(await isDbReachable()))(
  'GET /tournaments/:tournamentId/entry-list (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'entry-list-route-test-region';
    const testEmailDomain = 'entry-list-route-test.example.com';

    async function createTournamentAndRegulation(
      suffix: string,
    ): Promise<{tournamentId: string; regulationId: string}> {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${testRegionSlug + '-' + suffix}, 'テスト地域')
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, capacity, entry_opens_at, entry_closes_at
        ) values (
          ${region.id}, 'saikyoi', 'テスト大会', null,
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
        tournamentId: tournament.id as string,
        regulationId: regulation.id as string,
      };
    }

    async function createEntry(
      tournamentId: string,
      regulationId: string,
      status: 'pending_verification' | 'confirmed' | 'waitlisted' | 'cancelled',
      waitlistPosition: number | null,
    ): Promise<void> {
      const email = `entry-${crypto.randomUUID()}@${testEmailDomain}`;
      const [region] = await sql`
        select region_id from tournaments where id = ${tournamentId}
      `;
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (${region.region_id}, ${email}, ${await hashPassword('password123')})
        returning id
      `;
      await sql`
        insert into entries (
          participant_id, tournament_id, name, furigana, display_name,
          regulation_id, free_text, status, waitlist_position
        ) values (
          ${participant.id}, ${tournamentId}, '山田太郎', 'ヤマダタロウ', '太郎',
          ${regulationId}, '自由記述', ${status}, ${waitlistPosition}
        )
      `;
    }

    afterAll(async () => {
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

    it('omits personal fields from the response', async () => {
      const fixture = await createTournamentAndRegulation('personal-fields');
      await createEntry(
        fixture.tournamentId,
        fixture.regulationId,
        'confirmed',
        null,
      );

      const res = await app.request(
        `/api/tournaments/${fixture.tournamentId}/entry-list`,
        {},
        env,
      );
      const body = (await res.json()) as Array<Record<string, unknown>>;

      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0]).not.toHaveProperty('email');
      expect(body[0]).not.toHaveProperty('name');
      expect(body[0]).not.toHaveProperty('furigana');
      expect(body[0]).not.toHaveProperty('freeText');
    });

    it('masks cancelled entries as "キャンセル"', async () => {
      const fixture = await createTournamentAndRegulation('cancelled');
      await createEntry(
        fixture.tournamentId,
        fixture.regulationId,
        'cancelled',
        null,
      );

      const res = await app.request(
        `/api/tournaments/${fixture.tournamentId}/entry-list`,
        {},
        env,
      );
      const body = (await res.json()) as Array<Record<string, unknown>>;

      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].displayName).toBe('キャンセル');
      expect(body[0].status).toBe('cancelled');
    });

    it('excludes pending_verification entries', async () => {
      const fixture = await createTournamentAndRegulation('pending');
      await createEntry(
        fixture.tournamentId,
        fixture.regulationId,
        'pending_verification',
        null,
      );

      const res = await app.request(
        `/api/tournaments/${fixture.tournamentId}/entry-list`,
        {},
        env,
      );
      const body = (await res.json()) as Array<Record<string, unknown>>;

      expect(res.status).toBe(200);
      expect(body).toHaveLength(0);
    });
  },
);
