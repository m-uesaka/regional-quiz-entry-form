import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import {sign} from 'hono/jwt';
import type {Bindings} from '../types/env';
import {app} from '../index';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';

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
  ...PERMISSIVE_PLATFORM_BINDINGS,
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

async function regionalStaffCookie(): Promise<string> {
  const token = await sign(
    {
      sub: '88888888-8888-8888-8888-888888888888',
      role: 'regional',
      regionId: '00000000-0000-0000-0000-000000000000',
      tournamentType: 'saikyoi',
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

// These requests short-circuit in `requireGeneralStaff()` or `zValidator()`
// before any database call, so they run unconditionally (including CI).
describe('regions routes (request validation)', () => {
  it('returns 401 without a staff session', async () => {
    const res = await app.request('/api/regions', {}, env);

    expect(res.status).toBe(401);
  });

  it('returns 403 for regional staff', async () => {
    const cookie = await regionalStaffCookie();

    const res = await app.request('/api/regions', {headers: {cookie}}, env);

    expect(res.status).toBe(403);
  });

  it('rejects a slug that is not URL-safe with 400', async () => {
    const cookie = await generalStaffCookie();

    const res = await app.request(
      '/api/regions',
      {
        method: 'POST',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify({slug: 'Kanto/2026', name: '関東'}),
      },
      env,
    );

    expect(res.status).toBe(400);
  });
});

describe.skipIf(!(await isDbReachable()))(
  'regions routes (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const testSlugPrefix = 'regions-route-test';

    // Cleaning up on the way in as well as on the way out: an interrupted
    // run (or one where the `afterAll` delete itself failed) would otherwise
    // leave rows behind and make the next run's create fail with a 409 for a
    // reason that has nothing to do with the code under test.
    beforeAll(async () => {
      await sql`delete from regions where slug like ${testSlugPrefix + '%'}`;
    });

    afterAll(async () => {
      await sql`delete from regions where slug like ${testSlugPrefix + '%'}`;
      await sql.close();
    });

    async function createRegion(
      slug: string,
      name: string,
      allowsDualEntry?: boolean,
    ): Promise<Response> {
      const cookie = await generalStaffCookie();
      return app.request(
        '/api/regions',
        {
          method: 'POST',
          headers: {cookie, 'content-type': 'application/json'},
          body: JSON.stringify(
            allowsDualEntry === undefined
              ? {slug, name}
              : {slug, name, allowsDualEntry},
          ),
        },
        env,
      );
    }

    it('creates a region and returns 201', async () => {
      const slug = `${testSlugPrefix}-create`;

      const res = await createRegion(slug, '作成テスト地域');
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(201);
      expect(body.slug).toBe(slug);
      expect(body.name).toBe('作成テスト地域');
      expect(typeof body.id).toBe('string');
      // Left out of the body, so it lands on the restrictive default rather
      // than silently allowing double entries.
      expect(body.allowsDualEntry).toBe(false);
    });

    it('creates a region that allows dual entry when asked to', async () => {
      const slug = `${testSlugPrefix}-create-dual`;

      const res = await createRegion(slug, '重複可テスト地域', true);
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(201);
      expect(body.allowsDualEntry).toBe(true);
    });

    it('returns 409 for a duplicate slug', async () => {
      const slug = `${testSlugPrefix}-dup`;
      // Asserted so that a failure of the *first* insert can't be what makes
      // the second one 409.
      expect((await createRegion(slug, '重複テスト地域')).status).toBe(201);

      const res = await createRegion(slug, '重複テスト地域2');
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(409);
      expect(body.error).toBe('slug already in use');
    });

    it('lists regions for general staff', async () => {
      const slug = `${testSlugPrefix}-list`;
      await createRegion(slug, '一覧テスト地域');
      const cookie = await generalStaffCookie();

      const res = await app.request('/api/regions', {headers: {cookie}}, env);
      const body = (await res.json()) as Array<Record<string, unknown>>;

      expect(res.status).toBe(200);
      expect(body.some(region => region.slug === slug)).toBe(true);
    });

    it('updates the name and leaves the slug untouched', async () => {
      const slug = `${testSlugPrefix}-update`;
      const created = (await (
        await createRegion(slug, '更新前地域', true)
      ).json()) as {id: string};
      const cookie = await generalStaffCookie();

      const res = await app.request(
        `/api/regions/${created.id}`,
        {
          method: 'PATCH',
          headers: {cookie, 'content-type': 'application/json'},
          body: JSON.stringify({
            name: '更新後地域',
            slug: `${testSlugPrefix}-renamed`,
          }),
        },
        env,
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body.id).toBe(created.id);
      expect(body.name).toBe('更新後地域');
      expect(body.slug).toBe(slug);
      // Not part of the body, so the rename left the region's dual-entry
      // setting exactly as it was.
      expect(body.allowsDualEntry).toBe(true);
    });

    // Sent without a `name` on purpose: a client that had to resend one
    // would write back whatever it read before, undoing a rename another
    // staff member made in the meantime.
    it('updates allowsDualEntry alone and leaves the name untouched', async () => {
      const slug = `${testSlugPrefix}-update-dual`;
      const created = (await (
        await createRegion(slug, '重複設定更新地域')
      ).json()) as {id: string};
      const cookie = await generalStaffCookie();

      const res = await app.request(
        `/api/regions/${created.id}`,
        {
          method: 'PATCH',
          headers: {cookie, 'content-type': 'application/json'},
          body: JSON.stringify({allowsDualEntry: true}),
        },
        env,
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body.allowsDualEntry).toBe(true);
      expect(body.name).toBe('重複設定更新地域');
    });

    it('rejects a body with nothing to update', async () => {
      const slug = `${testSlugPrefix}-update-empty`;
      const created = (await (
        await createRegion(slug, '空更新地域')
      ).json()) as {id: string};
      const cookie = await generalStaffCookie();

      const res = await app.request(
        `/api/regions/${created.id}`,
        {
          method: 'PATCH',
          headers: {cookie, 'content-type': 'application/json'},
          body: JSON.stringify({}),
        },
        env,
      );

      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown region', async () => {
      const cookie = await generalStaffCookie();

      const res = await app.request(
        '/api/regions/11111111-1111-1111-1111-111111111111',
        {
          method: 'PATCH',
          headers: {cookie, 'content-type': 'application/json'},
          body: JSON.stringify({name: '存在しない地域'}),
        },
        env,
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(404);
      expect(body.error).toBe('region not found');
    });
  },
);
