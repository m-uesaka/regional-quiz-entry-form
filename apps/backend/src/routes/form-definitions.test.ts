import {afterAll, afterEach, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import {sign} from 'hono/jwt';
import type {TournamentType} from '@regional-quiz/shared';
import type {Bindings} from '../types/env';
import app from '../index';
import {PERMISSIVE_SECURITY_BINDINGS} from '../test-support/bindings';

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
  ...PERMISSIVE_SECURITY_BINDINGS,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
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

/**
 * A definition YAML for the given tournament type. The slug has to name the
 * type of the tournament being uploaded to, or the API rejects it with 400.
 * @param tournamentSlug The tournament type slug to put in the YAML.
 */
function yamlFor(tournamentSlug: TournamentType): string {
  return `
tournamentSlug: ${tournamentSlug}
fields:
  - key: agree_rules
    label: 規約に同意する
    type: checkbox
    required: true
`;
}

const validYaml = yamlFor('saikyoi');

// These requests short-circuit in `requireGeneralStaff()` or `zValidator()`
// before any database call, so they run unconditionally (including CI)
// against a fixed tournament UUID rather than a Supabase-provisioned one.
describe('form-definitions routes (request validation)', () => {
  const fixedTournamentId = '00000000-0000-0000-0000-000000000000';

  it('rejects a non-UUID tournamentId on the public read with 400', async () => {
    const res = await app.request('/api/form-definitions/not-a-uuid', {}, env);

    expect(res.status).toBe(400);
  });

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

// Mocks the `fetch` call `@supabase/supabase-js` makes for
// `.from('form_field_defs').select(...)` (same convention as
// `routes/entry-list.test.ts`'s `mockEntriesFetch`), so these run
// unconditionally in CI without a local Supabase stack.
function mockFormFieldDefsFetch(rows: unknown[]): void {
  globalThis.fetch = (() =>
    Promise.resolve(Response.json(rows))) as unknown as typeof fetch;
}

describe('GET /form-definitions/:tournamentId (mocked Supabase)', () => {
  const originalFetch = globalThis.fetch;
  const tournamentId = '12345678-1234-1234-1234-123456789012';

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('serves the definitions without a staff session', async () => {
    mockFormFieldDefsFetch([
      {
        field_key: 'agree_rules',
        label: '規約に同意する',
        field_type: 'checkbox',
        required: true,
        options: null,
        display_order: 0,
      },
      {
        field_key: 't_shirt_size',
        label: 'Tシャツサイズ',
        field_type: 'radio',
        required: false,
        options: ['S', 'M', 'L'],
        display_order: 1,
      },
    ]);

    const res = await app.request(
      `/api/form-definitions/${tournamentId}`,
      {},
      env,
    );
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(body).toEqual([
      {
        fieldKey: 'agree_rules',
        label: '規約に同意する',
        fieldType: 'checkbox',
        required: true,
        options: null,
        displayOrder: 0,
      },
      {
        fieldKey: 't_shirt_size',
        label: 'Tシャツサイズ',
        fieldType: 'radio',
        required: false,
        options: ['S', 'M', 'L'],
        displayOrder: 1,
      },
    ]);
  });

  it('returns an empty list for a tournament with no definitions', async () => {
    mockFormFieldDefsFetch([]);

    const res = await app.request(
      `/api/form-definitions/${tournamentId}`,
      {},
      env,
    );

    const body = (await res.json()) as unknown[];

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe.skipIf(!(await isDbReachable()))(
  'form-definitions routes (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testRegionSlug = 'form-definitions-route-test-region';
    // `tournaments` is unique on `(region_id, type)`, so each test gets its
    // own region (suffixed slug) rather than sharing one.
    const testRegionSlugPattern = `${testRegionSlug}-%`;

    async function deleteTestRegions(): Promise<void> {
      await sql`delete from form_field_defs where tournament_id in (
        select id from tournaments where region_id in (
          select id from regions where slug like ${testRegionSlugPattern}
        )
      )`;
      await sql`delete from tournaments where region_id in (
        select id from regions where slug like ${testRegionSlugPattern}
      )`;
      await sql`delete from regions where slug like ${testRegionSlugPattern}`;
    }

    // Also cleaned up up front, so rows left behind by an interrupted run
    // don't collide with this run's inserts.
    beforeAll(deleteTestRegions);

    afterAll(async () => {
      await deleteTestRegions();
      await sql.close();
    });

    /**
     * Creates a 最強位 tournament in a region of its own and returns its ID.
     * @param regionSuffix Distinguishes this test's region from the others'.
     */
    async function createTestTournament(regionSuffix: string): Promise<string> {
      const [region] = await sql`
        insert into regions (slug, name)
        values (${`${testRegionSlug}-${regionSuffix}`}, 'テスト地域')
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

    async function fieldKeysOf(tournamentId: string): Promise<string[]> {
      const rows = await sql`
        select field_key from form_field_defs
        where tournament_id = ${tournamentId}
        order by display_order
      `;
      return rows.map((row: {field_key: string}) => row.field_key);
    }

    it('uploads a form definition for general staff', async () => {
      const tournamentId = await createTestTournament('upload');
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
      expect(await fieldKeysOf(tournamentId)).toEqual(['agree_rules']);
    });

    it('rejects a YAML slug naming another tournament type with 400', async () => {
      const tournamentId = await createTestTournament('mismatch');
      const cookie = await generalStaffCookie();

      await sql`
        insert into form_field_defs (
          tournament_id, field_key, label, field_type, required, display_order
        ) values
          (${tournamentId}, 'existing_field', '既存フィールド', 'textarea', false, 0)
      `;

      const res = await app.request(
        `/api/form-definitions/${tournamentId}`,
        {
          method: 'PUT',
          headers: {cookie, 'content-type': 'application/json'},
          body: JSON.stringify({yaml: yamlFor('shinjinou')}),
        },
        env,
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(400);
      expect(body.error).toContain('tournamentSlug');
      // The existing definition must survive a rejected upload —
      // `sync_form_field_defs()` deletes before inserting, so a check that
      // ran too late would already have wiped it.
      expect(await fieldKeysOf(tournamentId)).toEqual(['existing_field']);
    });

    it('rejects an unknown tournament with 404', async () => {
      const cookie = await generalStaffCookie();

      const res = await app.request(
        '/api/form-definitions/00000000-0000-0000-0000-000000000000',
        {
          method: 'PUT',
          headers: {cookie, 'content-type': 'application/json'},
          body: JSON.stringify({yaml: validYaml}),
        },
        env,
      );

      expect(res.status).toBe(404);
    });
  },
);
