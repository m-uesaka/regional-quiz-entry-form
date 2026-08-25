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

const ENTRY_ID = '11111111-1111-1111-1111-111111111111';

// Short-circuits in `requireParticipant()` before any database call, so it
// runs unconditionally (including CI).
describe('mypage routes (request validation)', () => {
  it('rejects a request without a participant session with 401', async () => {
    const res = await app.request('/api/mypage/entries', {}, env);

    expect(res.status).toBe(401);
  });

  it('rejects a detail request without a participant session with 401', async () => {
    const res = await app.request(`/api/mypage/entries/${ENTRY_ID}`, {}, env);

    expect(res.status).toBe(401);
  });

  it('rejects a PATCH without a participant session with 401', async () => {
    const res = await app.request(
      `/api/mypage/entries/${ENTRY_ID}`,
      {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({}),
      },
      env,
    );

    expect(res.status).toBe(401);
  });

  it('rejects a PATCH with an invalid body with 400', async () => {
    const res = await app.request(
      `/api/mypage/entries/${ENTRY_ID}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          cookie: await participantCookie(
            '22222222-2222-2222-2222-222222222222',
          ),
        },
        body: JSON.stringify({name: ''}),
      },
      env,
    );

    expect(res.status).toBe(400);
  });
});

describe.skipIf(!(await isDbReachable()))(
  'mypage routes (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'mypage-route-test-region';

    afterAll(async () => {
      await sql`delete from form_field_defs where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlug + '%'}
        )
      )`;
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
      options: {entryOpensAt?: string; entryClosesAt?: string} = {},
    ): Promise<string> {
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at
        ) values (
          ${regionId}, ${type}, 'テスト大会',
          ${options.entryOpensAt ?? new Date().toISOString()},
          ${options.entryClosesAt ?? new Date().toISOString()}
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
    ): Promise<string> {
      const [entry] = await sql`
        insert into entries (
          participant_id, tournament_id, name, furigana, display_name,
          regulation_id, status
        ) values (
          ${participantId}, ${tournamentId}, '山田太郎', 'ヤマダタロウ', '太郎',
          ${regulationId}, 'confirmed'
        )
        returning id
      `;
      return entry.id as string;
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

    const OPEN_PERIOD = {
      entryOpensAt: '2020-01-01T00:00:00Z',
      entryClosesAt: '2099-01-01T00:00:00Z',
    };

    const EDIT_PATCH = {
      name: '山田花子',
      furigana: 'ヤマダハナコ',
      displayName: '花子',
      freeText: '更新後の自由記述',
      customFieldValues: {t_shirt_size: 'L'},
    };

    /** Adds the `t_shirt_size` custom field `EDIT_PATCH` answers. */
    async function createFormFieldDef(tournamentId: string): Promise<void> {
      await sql`
        insert into form_field_defs (
          tournament_id, field_key, label, field_type, required, options,
          display_order
        ) values (
          ${tournamentId}, 't_shirt_size', 'Tシャツサイズ', 'radio', true,
          ${['S', 'M', 'L']}::jsonb, 0
        )
      `;
    }

    async function patchEntry(
      entryId: string,
      participantId: string,
    ): Promise<Response> {
      return app.request(
        `/api/mypage/entries/${entryId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            cookie: await participantCookie(participantId),
          },
          body: JSON.stringify(EDIT_PATCH),
        },
        env,
      );
    }

    it("returns an entry's detail with the tournament's form field defs", async () => {
      const regionId = await createRegion('detail');
      const tournamentId = await createTournament(
        regionId,
        'saikyoi',
        OPEN_PERIOD,
      );
      const regulationId = await createRegulation(tournamentId);
      const participantId = await createParticipant(
        regionId,
        'mypage-detail@example.com',
      );
      const entryId = await createEntry(
        participantId,
        tournamentId,
        regulationId,
      );
      await createFormFieldDef(tournamentId);

      const res = await app.request(
        `/api/mypage/entries/${entryId}`,
        {headers: {cookie: await participantCookie(participantId)}},
        env,
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body).toMatchObject({
        id: entryId,
        name: '山田太郎',
        regulationLabel: 'テストレギュレーション',
        formFieldDefs: [
          {
            fieldKey: 't_shirt_size',
            label: 'Tシャツサイズ',
            fieldType: 'radio',
            required: true,
            options: ['S', 'M', 'L'],
            displayOrder: 0,
          },
        ],
      });
    });

    it("returns 404 for another participant's entry detail", async () => {
      const regionId = await createRegion('detail-other');
      const tournamentId = await createTournament(
        regionId,
        'saikyoi',
        OPEN_PERIOD,
      );
      const regulationId = await createRegulation(tournamentId);
      const ownerId = await createParticipant(
        regionId,
        'mypage-detail-owner@example.com',
      );
      const otherId = await createParticipant(
        regionId,
        'mypage-detail-intruder@example.com',
      );
      const entryId = await createEntry(ownerId, tournamentId, regulationId);

      const res = await app.request(
        `/api/mypage/entries/${entryId}`,
        {headers: {cookie: await participantCookie(otherId)}},
        env,
      );

      expect(res.status).toBe(404);
    });

    it('updates the entry within the entry period', async () => {
      const regionId = await createRegion('patch-open');
      const tournamentId = await createTournament(
        regionId,
        'saikyoi',
        OPEN_PERIOD,
      );
      const regulationId = await createRegulation(tournamentId);
      const participantId = await createParticipant(
        regionId,
        'mypage-patch@example.com',
      );
      const entryId = await createEntry(
        participantId,
        tournamentId,
        regulationId,
      );
      await createFormFieldDef(tournamentId);

      const res = await patchEntry(entryId, participantId);

      expect(res.status).toBe(200);
      const [row] = await sql`
        select name, display_name, free_text, custom_field_values
        from entries where id = ${entryId}
      `;
      expect(row.name).toBe('山田花子');
      expect(row.display_name).toBe('花子');
      expect(row.free_text).toBe('更新後の自由記述');
      expect(row.custom_field_values).toEqual({t_shirt_size: 'L'});
    });

    it('rejects an update outside the entry period with 403', async () => {
      const regionId = await createRegion('patch-closed');
      const tournamentId = await createTournament(regionId, 'saikyoi', {
        entryOpensAt: '2020-01-01T00:00:00Z',
        entryClosesAt: '2020-01-02T00:00:00Z',
      });
      const regulationId = await createRegulation(tournamentId);
      const participantId = await createParticipant(
        regionId,
        'mypage-patch-closed@example.com',
      );
      const entryId = await createEntry(
        participantId,
        tournamentId,
        regulationId,
      );

      const res = await patchEntry(entryId, participantId);

      expect(res.status).toBe(403);
      const [row] = await sql`
        select name from entries where id = ${entryId}
      `;
      expect(row.name).toBe('山田太郎');
    });
  },
);
