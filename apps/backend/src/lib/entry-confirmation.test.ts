import {afterAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import type {Bindings} from '../types/env';
import {confirmEntryByToken} from './entry-confirmation';
import {generateToken, hashToken} from './token';
import {hashPassword} from './password';

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
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  MAIL_API_KEY: 'dummy-mail-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET: 'test-session-secret',
};

describe.skipIf(!(await isDbReachable()))(
  'confirmEntryByToken (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'entry-confirmation-test-region';
    const testEmailDomain = 'entry-confirmation-test.example.com';

    afterAll(async () => {
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

    async function createTournamentAndRegulation(
      suffix: string,
      capacity: number | null,
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
          ${region.id}, 'saikyoi', 'テスト大会', ${capacity},
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

    async function createEntryFixture(
      regionId: string,
      tournamentId: string,
      regulationId: string,
      status: 'pending_verification' | 'confirmed' = 'pending_verification',
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
          regulation_id, status
        ) values (
          ${participant.id}, ${tournamentId}, '山田太郎', 'ヤマダタロウ', '太郎',
          ${regulationId}, ${status}
        )
        returning id
      `;
      return entry.id as string;
    }

    async function createTokenFixture(
      entryId: string,
      options: {expiresAt?: string; used?: boolean} = {},
    ): Promise<string> {
      const token = generateToken();
      await sql`
        insert into email_verification_tokens (
          entry_id, token_hash, expires_at, used_at
        ) values (
          ${entryId}, ${await hashToken(token)},
          ${options.expiresAt ?? '2099-01-01T00:00:00Z'},
          ${options.used ? '2020-01-01T00:00:00Z' : null}
        )
      `;
      return token;
    }

    it('confirms a valid, unused token', async () => {
      const fixture = await createTournamentAndRegulation('confirm', null);
      const entryId = await createEntryFixture(
        fixture.regionId,
        fixture.tournamentId,
        fixture.regulationId,
      );
      const token = await createTokenFixture(entryId);

      const result = await confirmEntryByToken(env, token);

      expect(result).toEqual({ok: true, status: 'confirmed'});
      const [entryRow] = await sql`
        select status, email_verified_at from entries where id = ${entryId}
      `;
      expect(entryRow.status).toBe('confirmed');
      expect(entryRow.email_verified_at).not.toBeNull();
    });

    it('waitlists an entry when capacity is full', async () => {
      const fixture = await createTournamentAndRegulation('capacity', 1);
      await createEntryFixture(
        fixture.regionId,
        fixture.tournamentId,
        fixture.regulationId,
        'confirmed',
      );
      const entryId = await createEntryFixture(
        fixture.regionId,
        fixture.tournamentId,
        fixture.regulationId,
      );
      const token = await createTokenFixture(entryId);

      const result = await confirmEntryByToken(env, token);

      expect(result).toEqual({ok: true, status: 'waitlisted'});
      const [entryRow] = await sql`
        select status, waitlist_position from entries where id = ${entryId}
      `;
      expect(entryRow.status).toBe('waitlisted');
      expect(entryRow.waitlist_position).toBe(1);
    });

    it('rejects an expired token', async () => {
      const fixture = await createTournamentAndRegulation('expired', null);
      const entryId = await createEntryFixture(
        fixture.regionId,
        fixture.tournamentId,
        fixture.regulationId,
      );
      const token = await createTokenFixture(entryId, {
        expiresAt: '2020-01-01T00:00:00Z',
      });

      const result = await confirmEntryByToken(env, token);

      expect(result.ok).toBe(false);
    });

    it('rejects an already-used token', async () => {
      const fixture = await createTournamentAndRegulation('used', null);
      const entryId = await createEntryFixture(
        fixture.regionId,
        fixture.tournamentId,
        fixture.regulationId,
      );
      const token = await createTokenFixture(entryId, {used: true});

      const result = await confirmEntryByToken(env, token);

      expect(result.ok).toBe(false);
    });

    it('rejects an unknown token', async () => {
      const result = await confirmEntryByToken(env, generateToken());

      expect(result.ok).toBe(false);
    });
  },
);
