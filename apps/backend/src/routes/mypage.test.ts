import {afterAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import {sign} from 'hono/jwt';
import type {Bindings} from '../types/env';
import app from '../index';

// Local Supabase stack (`supabase start`), same convention as
// `routes/tournaments.test.ts`. Skipped automatically when it isn't
// reachable, e.g. in CI.
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
const SESSION_SECRET = 'test-session-secret';

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
  SESSION_SECRET,
};

async function participantCookie(participantId: string): Promise<string> {
  const token = await sign(
    {sub: participantId, exp: Math.floor(Date.now() / 1000) + 3600},
    SESSION_SECRET,
  );
  return `participant_session=${token}`;
}

// Short-circuits in `requireParticipant()` before any database call, so it
// runs unconditionally (including CI).
describe('GET /mypage/entries (request validation)', () => {
  it('rejects a request without a participant session with 401', async () => {
    const res = await app.request('/api/mypage/entries', {}, env);

    expect(res.status).toBe(401);
  });
});

describe.skipIf(!(await isDbReachable()))(
  'GET /mypage/entries (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'mypage-route-test-region';

    afterAll(async () => {
      await sql`delete from entries where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlug + '%'}
        )
      )`;
      await sql`delete from participants where region_id in (
        select id from regions where slug like ${testRegionSlug + '%'}
      )`;
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

    async function createRegion(suffix: string): Promise<string> {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${testRegionSlug + '-' + suffix}, 'テスト地域')
        returning id
      `;
      return region.id as string;
    }

    async function createTournament(
      regionId: string,
      type: 'saikyoi' | 'shinjinou',
    ): Promise<string> {
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at
        ) values (
          ${regionId}, ${type}, 'テスト大会', now(), now()
        )
        returning id
      `;
      return tournament.id as string;
    }

    async function createRegulation(tournamentId: string): Promise<string> {
      const [regulation] = await sql`
        insert into regulations (tournament_id, label)
        values (${tournamentId}, 'テストレギュレーション')
        returning id
      `;
      return regulation.id as string;
    }

    async function createParticipant(
      regionId: string,
      email: string,
    ): Promise<string> {
      const [participant] = await sql`
        insert into participants (region_id, email, password_hash)
        values (${regionId}, ${email}, 'hash')
        returning id
      `;
      return participant.id as string;
    }

    async function createEntry(
      participantId: string,
      tournamentId: string,
      regulationId: string,
    ): Promise<void> {
      await sql`
        insert into entries (
          participant_id, tournament_id, name, furigana, display_name,
          regulation_id, status
        ) values (
          ${participantId}, ${tournamentId}, '山田太郎', 'ヤマダタロウ', '太郎',
          ${regulationId}, 'confirmed'
        )
      `;
    }

    it("returns only the logged-in participant's entries", async () => {
      const regionId = await createRegion('own');
      const tournamentId = await createTournament(regionId, 'saikyoi');
      const regulationId = await createRegulation(tournamentId);
      const participantId = await createParticipant(
        regionId,
        'mypage-own@example.com',
      );
      const otherParticipantId = await createParticipant(
        regionId,
        'mypage-other@example.com',
      );
      await createEntry(participantId, tournamentId, regulationId);
      await createEntry(otherParticipantId, tournamentId, regulationId);

      const res = await app.request(
        '/api/mypage/entries',
        {headers: {cookie: await participantCookie(participantId)}},
        env,
      );
      const body = (await res.json()) as Array<{tournamentId: string}>;

      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].tournamentId).toBe(tournamentId);
    });

    it('returns entries for both saikyoi and shinjinou in the same region', async () => {
      const regionId = await createRegion('both-types');
      const saikyoiId = await createTournament(regionId, 'saikyoi');
      const shinjinouId = await createTournament(regionId, 'shinjinou');
      const saikyoiRegulationId = await createRegulation(saikyoiId);
      const shinjinouRegulationId = await createRegulation(shinjinouId);
      const participantId = await createParticipant(
        regionId,
        'mypage-both@example.com',
      );
      await createEntry(participantId, saikyoiId, saikyoiRegulationId);
      await createEntry(participantId, shinjinouId, shinjinouRegulationId);

      const res = await app.request(
        '/api/mypage/entries',
        {headers: {cookie: await participantCookie(participantId)}},
        env,
      );
      const body = (await res.json()) as Array<{tournament: {type: string}}>;

      expect(res.status).toBe(200);
      expect(body.map(entry => entry.tournament.type).sort()).toEqual([
        'saikyoi',
        'shinjinou',
      ]);
    });
  },
);
