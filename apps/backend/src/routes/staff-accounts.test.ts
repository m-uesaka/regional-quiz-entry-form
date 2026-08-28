import {afterAll, beforeAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';
import {sign} from 'hono/jwt';
import type {Bindings} from '../types/env';
import {PERMISSIVE_SECURITY_BINDINGS} from '../test-support/bindings';
import app from '../index';

// Local Supabase stack (`supabase start`), same convention as
// `routes/regions.test.ts`. Skipped automatically when it isn't reachable,
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

const BASE_ENV: Bindings = {
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
describe('staff account routes (request validation)', () => {
  it('returns 401 without a staff session', async () => {
    const res = await app.request('/api/staff/accounts', {}, BASE_ENV);

    expect(res.status).toBe(401);
  });

  it('returns 403 for regional staff', async () => {
    const cookie = await regionalStaffCookie();

    const res = await app.request(
      '/api/staff/accounts',
      {headers: {cookie}},
      BASE_ENV,
    );

    expect(res.status).toBe(403);
  });

  it('rejects a regional account that carries only half its scope', async () => {
    const cookie = await generalStaffCookie();

    const res = await app.request(
      '/api/staff/accounts',
      {
        method: 'POST',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify({
          role: 'regional',
          email: 'half-scoped@example.com',
          regionId: '11111111-1111-1111-1111-111111111111',
        }),
      },
      BASE_ENV,
    );

    expect(res.status).toBe(400);
  });
});

describe.skipIf(!(await isDbReachable()))(
  'staff account routes (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);
    const emailPrefix = 'staff-accounts-route-test';
    const regionSlug = 'staff-accounts-route-test';

    // Every mail the route sent through the stub below, newest last.
    let sentMail: Array<{to: string; subject: string; html: string}> = [];
    // Flipped by the one test that checks what happens when the provider is
    // down; the stub answers 200 for every other test.
    let mailStatus = 200;

    // A stand-in for Resend, pointed at by `MAIL_API_BASE_URL`. Stubbing the
    // provider this way rather than replacing `globalThis.fetch` leaves the
    // Supabase client's own fetch alone, which these tests need to reach the
    // local stack.
    //
    // Started in `beforeAll` rather than here: the body of a skipped
    // `describe` still runs, but its `afterAll` does not, so binding the port
    // at this level would leak a listening socket on every CI run -- the runs
    // where this suite is skipped for want of a local Supabase.
    let mailServer: ReturnType<typeof Bun.serve>;
    let env: Bindings;

    let regionId = '';

    async function deleteTestRows(): Promise<void> {
      await sql`delete from staff_accounts where email like ${emailPrefix + '%'}`;
      await sql`delete from regions where slug = ${regionSlug}`;
    }

    // Cleaning up on the way in as well as on the way out: an interrupted run
    // would otherwise leave accounts behind and make the next run's create
    // fail with a 409 for a reason that has nothing to do with the code under
    // test.
    beforeAll(async () => {
      mailServer = Bun.serve({
        port: 0,
        async fetch(req) {
          sentMail.push(
            (await req.json()) as {to: string; subject: string; html: string},
          );
          return new Response(null, {status: mailStatus});
        },
      });
      env = {
        ...BASE_ENV,
        MAIL_API_BASE_URL: `http://127.0.0.1:${mailServer.port}`,
      };

      await deleteTestRows();
      const [region] = await sql`
        insert into regions (slug, name)
        values (${regionSlug}, 'スタッフ管理テスト地域')
        returning id
      `;
      regionId = region.id;
    });

    afterAll(async () => {
      await deleteTestRows();
      await sql.close();
      await mailServer.stop(true);
    });

    async function createAccount(
      body: Record<string, unknown>,
    ): Promise<Response> {
      const cookie = await generalStaffCookie();
      return app.request(
        '/api/staff/accounts',
        {
          method: 'POST',
          headers: {cookie, 'content-type': 'application/json'},
          body: JSON.stringify(body),
        },
        env,
      );
    }

    /**
     * Re-issues a password link and returns the raw token out of the mail it
     * was sent in, which is the only place the token is ever readable.
     */
    async function reissueLink(
      staffAccountId: string,
      cookie: string,
    ): Promise<string> {
      sentMail = [];
      const res = await app.request(
        `/api/staff/accounts/${staffAccountId}/password-reset`,
        {method: 'POST', headers: {cookie}},
        env,
      );
      expect(res.status).toBe(200);
      expect(sentMail).toHaveLength(1);
      const token = sentMail[0].html.match(/token=([0-9a-f]+)/)?.[1];
      expect(token).toBeDefined();
      return token as string;
    }

    async function confirmReset(
      token: string,
      newPassword: string,
    ): Promise<Response> {
      return app.request(
        '/api/auth/staff/password-reset/confirm',
        {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({token, newPassword}),
        },
        env,
      );
    }

    function generalAccountBody(suffix: string): Record<string, unknown> {
      return {role: 'general', email: `${emailPrefix}-${suffix}@example.com`};
    }

    function regionalAccountBody(suffix: string): Record<string, unknown> {
      return {
        role: 'regional',
        email: `${emailPrefix}-${suffix}@example.com`,
        regionId,
        tournamentType: 'saikyoi',
      };
    }

    it('creates a general account with no region scope', async () => {
      const res = await createAccount(generalAccountBody('general'));
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(201);
      expect(body).toMatchObject({
        role: 'general',
        regionId: null,
        regionSlug: null,
        tournamentType: null,
        passwordSet: false,
      });
    });

    it('creates a regional account and sends a setup mail', async () => {
      sentMail = [];

      const res = await createAccount(regionalAccountBody('regional'));
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(201);
      expect(body).toMatchObject({
        role: 'regional',
        regionId,
        regionSlug,
        tournamentType: 'saikyoi',
        passwordSet: false,
      });
      expect(sentMail).toHaveLength(1);
      expect(sentMail[0].to).toBe(`${emailPrefix}-regional@example.com`);
      expect(sentMail[0].html).toContain(
        `${env.FRONTEND_URL}/staff/password-reset?token=`,
      );
    });

    it('never puts the initial password or its hash in the response', async () => {
      const created = (await (
        await createAccount(generalAccountBody('no-hash'))
      ).json()) as Record<string, unknown>;
      const cookie = await generalStaffCookie();

      const res = await app.request(
        '/api/staff/accounts',
        {headers: {cookie}},
        env,
      );
      const body = (await res.json()) as Array<Record<string, unknown>>;

      expect(res.status).toBe(200);
      const listed = body.find(account => account.id === created.id);
      expect(listed).toBeDefined();
      for (const account of body) {
        expect(account).not.toHaveProperty('password_hash');
        expect(account).not.toHaveProperty('passwordHash');
      }
      expect(created).not.toHaveProperty('password_hash');
    });

    it('stores an unusable hash so the account cannot log in yet', async () => {
      const email = `${emailPrefix}-unusable@example.com`;

      expect((await createAccount({role: 'general', email})).status).toBe(201);

      const [row] = await sql`
        select password_hash from staff_accounts where email = ${email}
      `;
      // Not a `salt:hash` pair of hex halves, so `verifyPassword()` refuses
      // every password submitted against it.
      expect(row.password_hash).not.toContain(':');

      const res = await app.request(
        '/api/auth/staff/login',
        {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({email, password: row.password_hash}),
        },
        env,
      );

      expect(res.status).toBe(401);
    });

    it('returns 409 for a duplicate email', async () => {
      // Asserted so that a failure of the *first* insert can't be what makes
      // the second one 409.
      expect((await createAccount(generalAccountBody('dup'))).status).toBe(201);

      const res = await createAccount(generalAccountBody('dup'));
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(409);
      expect(body.error).toBe('email already in use');
    });

    it('returns 400 for a region that does not exist', async () => {
      const res = await createAccount({
        ...regionalAccountBody('unknown-region'),
        regionId: '22222222-2222-2222-2222-222222222222',
      });
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(400);
      expect(body.error).toBe('unknown region');
    });

    it('reports a setup mail that could not be sent, having created the account', async () => {
      mailStatus = 500;
      const email = `${emailPrefix}-mail-down@example.com`;

      const res = await createAccount({role: 'general', email});
      const body = (await res.json()) as Record<string, unknown>;
      mailStatus = 200;

      expect(res.status).toBe(500);
      expect(body.error).toBe(
        'account created but the setup mail could not be sent',
      );
      // The account is there to be re-invited rather than re-created, which
      // is why the message says so instead of 'internal server error'.
      const rows = await sql`
        select id from staff_accounts where email = ${email}
      `;
      expect(rows).toHaveLength(1);
    });

    it('re-issues a link the staff member can set their password with', async () => {
      const email = `${emailPrefix}-reset@example.com`;
      const created = (await (
        await createAccount({role: 'general', email})
      ).json()) as {id: string};
      const cookie = await generalStaffCookie();

      const token = await reissueLink(created.id, cookie);

      expect((await confirmReset(token, 'new-staff-password')).status).toBe(
        200,
      );

      const login = await app.request(
        '/api/auth/staff/login',
        {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({email, password: 'new-staff-password'}),
        },
        env,
      );

      expect(login.status).toBe(200);
      // The link is one-time: replaying it after the password is set answers
      // the same 400 an unknown token would.
      expect((await confirmReset(token, 'another-password')).status).toBe(400);
    });

    it('burns the link it replaces when one is re-issued', async () => {
      const email = `${emailPrefix}-reissue@example.com`;
      const created = (await (
        await createAccount({role: 'general', email})
      ).json()) as {id: string};
      const cookie = await generalStaffCookie();

      const firstToken = await reissueLink(created.id, cookie);
      const secondToken = await reissueLink(created.id, cookie);
      expect(secondToken).not.toBe(firstToken);

      // The point of the re-issue: an invite that went to the wrong address
      // must not stay redeemable for the rest of its day-long TTL just
      // because nobody has clicked the replacement yet.
      const stale = await confirmReset(firstToken, 'stale-link-password');
      expect(stale.status).toBe(400);

      expect((await confirmReset(secondToken, 'fresh-password')).status).toBe(
        200,
      );
    });

    it('returns 404 when resetting an account that does not exist', async () => {
      const cookie = await generalStaffCookie();

      const res = await app.request(
        '/api/staff/accounts/33333333-3333-3333-3333-333333333333/password-reset',
        {method: 'POST', headers: {cookie}},
        env,
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(404);
      expect(body.error).toBe('staff account not found');
    });
  },
);
