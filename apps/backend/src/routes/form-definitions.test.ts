import {afterAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import {sign} from 'hono/jwt';
import type {Bindings} from '../types/env';
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
  SESSION_SECRET,
};

async function generalStaffCookie(): Promise<string> {
  const token = await sign(
    {
      sub: '99999999-9999-9999-9999-999999999999',
      role: 'general',
      regionId: null,
      tournamentType: null,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

async function regionalStaffCookie(regionId: string): Promise<string> {
  const token = await sign(
    {
      sub: '88888888-8888-8888-8888-888888888888',
      role: 'regional',
      regionId,
      tournamentType: 'saikyoi',
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

const validYaml = `
tournamentSlug: test-tournament
fields:
  - key: agree_rules
    label: 規約に同意する
    type: checkbox
    required: true
`;

// These requests short-circuit in `requireGeneralStaff()` or `zValidator()`
// before any database call, so they run unconditionally (including CI)
// against a fixed tournament UUID rather than a Supabase-provisioned one.
describe('form-definitions routes (request validation)', () => {
  const fixedTournamentId = '00000000-0000-0000-0000-000000000000';

  it('rejects regional staff with 403', async () => {
    const cookie = await regionalStaffCookie(
      '11111111-1111-1111-1111-111111111111',
    );

    const res = await app.request(
      `/api/form-definitions/${fixedTournamentId}`,
      {
        method: 'PUT',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify({yaml: validYaml}),
      },
      env,
    );

    expect(res.status).toBe(403);
  });

  it('rejects a body missing yaml with 400', async () => {
    const cookie = await generalStaffCookie();

    const res = await app.request(
      `/api/form-definitions/${fixedTournamentId}`,
      {
        method: 'PUT',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify({}),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  it('rejects invalid yaml content with 400', async () => {
    const cookie = await generalStaffCookie();

    const res = await app.request(
      `/api/form-definitions/${fixedTournamentId}`,
      {
        method: 'PUT',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify({yaml: 'not: [valid, form, definition'}),
      },
      env,
    );

    expect(res.status).toBe(400);
  });
});

describe.skipIf(!(await isDbReachable()))(
  'form-definitions routes (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'form-definitions-route-test-region';

    afterAll(async () => {
      await sql`delete from form_field_defs where tournament_id in (
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

    async function createTestTournament(): Promise<string> {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${testRegionSlug}, 'テスト地域')
        on conflict (slug) do update set name = excluded.name
        returning id
      `;
      const [tournament] = await sql`
        insert into tournaments (
          region_id, type, name, entry_opens_at, entry_closes_at
        ) values (
          ${region.id}, 'saikyoi', 'テスト大会', now(), now()
        )
        returning id
      `;
      return tournament.id as string;
    }

    it('uploads a form definition for general staff', async () => {
      const tournamentId = await createTestTournament();
      const cookie = await generalStaffCookie();

      const res = await app.request(
        `/api/form-definitions/${tournamentId}`,
        {
          method: 'PUT',
          headers: {cookie, 'content-type': 'application/json'},
          body: JSON.stringify({yaml: validYaml}),
        },
        env,
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);

      const rows = await sql`
        select field_key from form_field_defs where tournament_id = ${tournamentId}
      `;
      expect(rows.length).toBe(1);
      expect(rows[0].field_key).toBe('agree_rules');
    });
  },
);
