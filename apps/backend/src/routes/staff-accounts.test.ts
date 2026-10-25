import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import {SQL} from 'bun';
import {sign} from 'hono/jwt';
import type {Bindings} from '../types/env';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';
import {app} from '../index';
import {isPasswordHashUsable} from '../lib/password';
import {
  isStaffSessionCheck,
  staffSessionAwareFetch,
  staffSessionRow,
  TEST_SESSIONS_VALID_FROM,
  TEST_SESSIONS_VALID_FROM_MS,
} from '../test-support/staff-session';

// Every staff guard checks the session against
// `staff_accounts.sessions_valid_from` before the handler runs; answer that
// read for the tests that don't stub `fetch` themselves.
const fetchWithoutSessionStub = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = staffSessionAwareFetch(fetchWithoutSessionStub);
});

afterEach(() => {
  globalThis.fetch = fetchWithoutSessionStub;
});

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
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ??
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
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
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
      sessionsValidFrom: TEST_SESSIONS_VALID_FROM_MS,
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
      sessionsValidFrom: TEST_SESSIONS_VALID_FROM_MS,
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

const GENERAL_STAFF_ID = '99999999-9999-9999-9999-999999999999';
const TARGET_STAFF_ID = '77777777-7777-7777-7777-777777777777';

/** A request the fake below received, other than the session check. */
interface RecordedRequest {
  method: string;
  url: URL;
  body: Record<string, unknown> | null;
}

/**
 * A stand-in for the `staff_accounts` table as far as the revoke endpoint
 * and the session check touch it: one `sessions_valid_from` per existing
 * account, which the check reads and the endpoint's PATCH moves.
 *
 * Kept stateful rather than answering each call with a canned body, so that
 * a test can follow a revocation through to the next request and see the
 * session it cut refused.
 * @param accounts The `sessions_valid_from` of every account that exists.
 * @param failWrites Whether the PATCH should fail as a database error would.
 */
function fakeStaffAccounts(
  accounts: Map<string, string>,
  failWrites = false,
): {requests: RecordedRequest[]} {
  const requests: RecordedRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const id = url.searchParams.get('id')?.replace(/^eq\./, '') ?? '';
    const current = accounts.get(id);
    if (isStaffSessionCheck(url.toString())) {
      return Response.json(
        current === undefined ? [] : [staffSessionRow(current)],
      );
    }
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
    requests.push({method: init?.method ?? 'GET', url, body});
    if (failWrites) {
      return Response.json({message: 'connection refused'}, {status: 500});
    }
    if (current === undefined) {
      return Response.json([]);
    }
    accounts.set(id, String(body?.sessions_valid_from));
    return Response.json([{id}]);
  }) as unknown as typeof fetch;
  return {requests};
}

async function revokeSessions(
  staffAccountId: string,
  cookie: string,
): Promise<Response> {
  return app.request(
    `/api/staff/accounts/${staffAccountId}/revoke-sessions`,
    {method: 'POST', headers: {cookie, origin: BASE_ENV.FRONTEND_URL}},
    BASE_ENV,
  );
}

describe('POST /staff/accounts/:id/revoke-sessions (mocked Supabase)', () => {
  it('POST /staff/accounts/:id/revoke-sessions moves sessions_valid_from', async () => {
    const accounts = new Map([
      [GENERAL_STAFF_ID, TEST_SESSIONS_VALID_FROM],
      [TARGET_STAFF_ID, TEST_SESSIONS_VALID_FROM],
    ]);
    const {requests} = fakeStaffAccounts(accounts);
    const startedAt = Date.now();

    const res = await revokeSessions(
      TARGET_STAFF_ID,
      await generalStaffCookie(),
    );

    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ok: true});
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('PATCH');
    expect(requests[0].url.pathname).toEndWith('/rest/v1/staff_accounts');
    expect(requests[0].url.searchParams.get('id')).toBe(
      `eq.${TARGET_STAFF_ID}`,
    );
    // Only the generation moves: the password (and everything else on the
    // row) is left alone, so the owner can log straight back in.
    expect(Object.keys(requests[0].body ?? {})).toEqual([
      'sessions_valid_from',
    ]);
    const movedTo = Date.parse(accounts.get(TARGET_STAFF_ID) ?? '');
    expect(movedTo).toBeGreaterThanOrEqual(startedAt);
    expect(movedTo).not.toBe(TEST_SESSIONS_VALID_FROM_MS);
    // Someone else's revocation leaves the caller's own sessions alone.
    expect(accounts.get(GENERAL_STAFF_ID)).toBe(TEST_SESSIONS_VALID_FROM);
  });

  it('POST /staff/accounts/:id/revoke-sessions returns 403 for regional staff', async () => {
    // The caller's own row is there too, so its session reads as current
    // and the role is what refuses it.
    const accounts = new Map([
      [TARGET_STAFF_ID, TEST_SESSIONS_VALID_FROM],
      ['88888888-8888-8888-8888-888888888888', TEST_SESSIONS_VALID_FROM],
    ]);
    const {requests} = fakeStaffAccounts(accounts);

    const res = await revokeSessions(
      TARGET_STAFF_ID,
      await regionalStaffCookie(),
    );

    expect(res.status).toBe(403);
    expect(requests).toHaveLength(0);
    expect(accounts.get(TARGET_STAFF_ID)).toBe(TEST_SESSIONS_VALID_FROM);
  });

  it('returns 401 without a staff session', async () => {
    const {requests} = fakeStaffAccounts(new Map());

    const res = await app.request(
      `/api/staff/accounts/${TARGET_STAFF_ID}/revoke-sessions`,
      {method: 'POST', headers: {origin: BASE_ENV.FRONTEND_URL}},
      BASE_ENV,
    );

    expect(res.status).toBe(401);
    expect(requests).toHaveLength(0);
  });

  it('a staff member may revoke their own sessions', async () => {
    // The lost-laptop case: the staff member cuts the session on the device
    // they no longer have from the one they still do -- which, being a
    // session of the same account, is cut along with it.
    const accounts = new Map([[GENERAL_STAFF_ID, TEST_SESSIONS_VALID_FROM]]);
    fakeStaffAccounts(accounts);
    const cookie = await generalStaffCookie();

    const res = await revokeSessions(GENERAL_STAFF_ID, cookie);

    expect(res.status).toBe(200);
    expect(accounts.get(GENERAL_STAFF_ID)).not.toBe(TEST_SESSIONS_VALID_FROM);

    // The request that did it was let through; the next one is not.
    const next = await app.request(
      '/api/staff/accounts',
      {headers: {cookie}},
      BASE_ENV,
    );
    expect(next.status).toBe(401);
  });

  it('returns 404 for an account that does not exist', async () => {
    fakeStaffAccounts(new Map([[GENERAL_STAFF_ID, TEST_SESSIONS_VALID_FROM]]));

    const res = await revokeSessions(
      TARGET_STAFF_ID,
      await generalStaffCookie(),
    );

    expect(res.status).toBe(404);
    expect((await res.json()) as unknown).toEqual({
      error: 'staff account not found',
    });
  });

  it('returns 400 for an id that is not a UUID', async () => {
    const {requests} = fakeStaffAccounts(
      new Map([[GENERAL_STAFF_ID, TEST_SESSIONS_VALID_FROM]]),
    );

    const res = await revokeSessions('not-a-uuid', await generalStaffCookie());

    expect(res.status).toBe(400);
    expect(requests).toHaveLength(0);
  });

  it('returns 500 when the update fails', async () => {
    const originalConsoleError = console.error;
    console.error = () => {};
    fakeStaffAccounts(
      new Map([
        [GENERAL_STAFF_ID, TEST_SESSIONS_VALID_FROM],
        [TARGET_STAFF_ID, TEST_SESSIONS_VALID_FROM],
      ]),
      true,
    );

    try {
      const res = await revokeSessions(
        TARGET_STAFF_ID,
        await generalStaffCookie(),
      );

      expect(res.status).toBe(500);
      expect((await res.json()) as unknown).toEqual({
        error: 'internal server error',
      });
    } finally {
      console.error = originalConsoleError;
    }
  });
});

/**
 * Answers the session check for the caller's own (enabled) account, and the
 * disable endpoint's `disable_staff_account()` call with `rpc`.
 * @param rpc What the RPC answers: nothing for success, or the error
 *     PostgREST would send back.
 */
function fakeDisableRpc(
  rpc: {status: number; body?: Record<string, unknown>} = {status: 204},
): {requests: RecordedRequest[]} {
  const requests: RecordedRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (isStaffSessionCheck(url.toString())) {
      return Response.json([staffSessionRow(TEST_SESSIONS_VALID_FROM)]);
    }
    requests.push({
      method: init?.method ?? 'GET',
      url,
      body:
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : null,
    });
    return rpc.body === undefined
      ? new Response(null, {status: rpc.status})
      : Response.json(rpc.body, {status: rpc.status});
  }) as unknown as typeof fetch;
  return {requests};
}

async function disableAccount(
  staffAccountId: string,
  cookie: string,
): Promise<Response> {
  return app.request(
    `/api/staff/accounts/${staffAccountId}/disable`,
    {method: 'POST', headers: {cookie, origin: BASE_ENV.FRONTEND_URL}},
    BASE_ENV,
  );
}

describe('POST /staff/accounts/:id/disable (mocked Supabase)', () => {
  it('hands the account to disable_staff_account()', async () => {
    const {requests} = fakeDisableRpc();

    const res = await disableAccount(
      TARGET_STAFF_ID,
      await generalStaffCookie(),
    );

    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ok: true});
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].url.pathname).toEndWith(
      '/rest/v1/rpc/disable_staff_account',
    );
    expect(requests[0].body).toEqual({p_staff_account_id: TARGET_STAFF_ID});
  });

  // A general staff member who locked themselves out could only be let back
  // in by another one -- and by no one, if they were the last.
  it("refuses to disable the caller's own account", async () => {
    const {requests} = fakeDisableRpc();

    const res = await disableAccount(
      GENERAL_STAFF_ID,
      await generalStaffCookie(),
    );

    expect(res.status).toBe(409);
    expect((await res.json()) as unknown).toEqual({
      error: 'cannot disable your own account',
    });
    expect(requests).toHaveLength(0);
  });

  // The param schema accepts either case, the claim is lowercase.
  it("refuses the caller's own account spelled in upper case", async () => {
    const {requests} = fakeDisableRpc();
    const ownId = 'abcdef00-0000-4000-8000-0000000000ab';
    const token = await sign(
      {
        sub: ownId,
        role: 'general',
        regionId: null,
        tournamentType: null,
        sessionsValidFrom: TEST_SESSIONS_VALID_FROM_MS,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      SESSION_SECRET,
    );

    const res = await disableAccount(
      ownId.toUpperCase(),
      `staff_session=${token}`,
    );

    expect(res.status).toBe(409);
    expect(requests).toHaveLength(0);
  });

  it('answers 409 when no general staff account would be left', async () => {
    fakeDisableRpc({
      status: 400,
      body: {code: 'P0004', message: 'cannot disable the last general'},
    });

    const res = await disableAccount(
      TARGET_STAFF_ID,
      await generalStaffCookie(),
    );

    expect(res.status).toBe(409);
    expect((await res.json()) as unknown).toEqual({
      error: 'cannot disable the last general staff account',
    });
  });

  it('answers 404 for an account that does not exist', async () => {
    fakeDisableRpc({
      status: 400,
      body: {code: 'P0002', message: 'staff account not found'},
    });

    const res = await disableAccount(
      TARGET_STAFF_ID,
      await generalStaffCookie(),
    );

    expect(res.status).toBe(404);
    expect((await res.json()) as unknown).toEqual({
      error: 'staff account not found',
    });
  });

  it('returns 403 for regional staff', async () => {
    const {requests} = fakeDisableRpc();

    const res = await disableAccount(
      TARGET_STAFF_ID,
      await regionalStaffCookie(),
    );

    expect(res.status).toBe(403);
    expect(requests).toHaveLength(0);
  });

  it('returns 500 when the call fails', async () => {
    const originalConsoleError = console.error;
    console.error = () => {};
    fakeDisableRpc({status: 500, body: {message: 'connection refused'}});

    try {
      const res = await disableAccount(
        TARGET_STAFF_ID,
        await generalStaffCookie(),
      );

      expect(res.status).toBe(500);
    } finally {
      console.error = originalConsoleError;
    }
  });
});

describe('POST /staff/accounts/:id/enable (mocked Supabase)', () => {
  it('clears disabled_at and nothing else', async () => {
    const accounts = new Map([
      [GENERAL_STAFF_ID, TEST_SESSIONS_VALID_FROM],
      [TARGET_STAFF_ID, TEST_SESSIONS_VALID_FROM],
    ]);
    const {requests} = fakeStaffAccounts(accounts);

    const res = await app.request(
      `/api/staff/accounts/${TARGET_STAFF_ID}/enable`,
      {
        method: 'POST',
        headers: {
          cookie: await generalStaffCookie(),
          origin: BASE_ENV.FRONTEND_URL,
        },
      },
      BASE_ENV,
    );

    expect(res.status).toBe(200);
    expect(requests[0].method).toBe('PATCH');
    expect(requests[0].url.searchParams.get('id')).toBe(
      `eq.${TARGET_STAFF_ID}`,
    );
    // The sessions disabling ended stay ended: the owner logs in afresh.
    expect(requests[0].body).toEqual({disabled_at: null});
    // A link written by a re-send that raced the disable must not revive.
    expect(requests).toHaveLength(2);
    expect(requests[1].method).toBe('DELETE');
    expect(requests[1].url.pathname).toEndWith(
      '/rest/v1/staff_password_reset_tokens',
    );
    expect(requests[1].url.searchParams.get('staff_account_id')).toBe(
      `eq.${TARGET_STAFF_ID}`,
    );
  });

  it('returns 404 for an account that does not exist', async () => {
    fakeStaffAccounts(new Map([[GENERAL_STAFF_ID, TEST_SESSIONS_VALID_FROM]]));

    const res = await app.request(
      `/api/staff/accounts/${TARGET_STAFF_ID}/enable`,
      {
        method: 'POST',
        headers: {
          cookie: await generalStaffCookie(),
          origin: BASE_ENV.FRONTEND_URL,
        },
      },
      BASE_ENV,
    );

    expect(res.status).toBe(404);
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
        {method: 'POST', headers: {cookie, origin: env.FRONTEND_URL}},
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
      // Not a hash in either format `verifyPassword()` reads, so it refuses
      // every password submitted against it.
      expect(isPasswordHashUsable(row.password_hash)).toBe(false);

      const res = await app.request(
        '/api/auth/staff/login',
        {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({
            email,
            scope: 'general',
            password: row.password_hash,
          }),
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
          body: JSON.stringify({
            email,
            scope: 'general',
            password: 'new-staff-password',
          }),
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
        {method: 'POST', headers: {cookie, origin: env.FRONTEND_URL}},
        env,
      );
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(404);
      expect(body.error).toBe('staff account not found');
    });

    /**
     * A cookie for the account `email` names, issued for the generation its
     * row carries right now -- i.e. what logging in as it would hand back.
     */
    async function realSessionCookie(email: string): Promise<string> {
      const [account] = await sql`
        select id, sessions_valid_from from staff_accounts where email = ${email}
      `;
      const token = await sign(
        {
          sub: account.id,
          role: 'general',
          regionId: null,
          tournamentType: null,
          sessionsValidFrom: new Date(account.sessions_valid_from).getTime(),
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        SESSION_SECRET,
      );
      return `staff_session=${token}`;
    }

    it('POST /staff/accounts/:id/revoke-sessions moves sessions_valid_from', async () => {
      const email = `${emailPrefix}-revoke@example.com`;
      const created = (await (
        await createAccount({role: 'general', email})
      ).json()) as {id: string};
      const [before] = await sql`
        select sessions_valid_from from staff_accounts where id = ${created.id}
      `;

      const res = await app.request(
        `/api/staff/accounts/${created.id}/revoke-sessions`,
        {
          method: 'POST',
          headers: {
            cookie: await generalStaffCookie(),
            origin: env.FRONTEND_URL,
          },
        },
        env,
      );

      expect(res.status).toBe(200);
      const [after] = await sql`
        select sessions_valid_from from staff_accounts where id = ${created.id}
      `;
      expect(new Date(after.sessions_valid_from).getTime()).not.toBe(
        new Date(before.sessions_valid_from).getTime(),
      );
    });

    it('a staff member may revoke their own sessions', async () => {
      const email = `${emailPrefix}-revoke-own@example.com`;
      const created = (await (
        await createAccount({role: 'general', email})
      ).json()) as {id: string};
      // From here on, against the real session check rather than the stub
      // the rest of this file uses, so the column this endpoint writes is
      // seen to be the one the guards read.
      globalThis.fetch = fetchWithoutSessionStub;
      const cookie = await realSessionCookie(email);
      const list = () =>
        app.request('/api/staff/accounts', {headers: {cookie}}, env);
      expect((await list()).status).toBe(200);

      const res = await app.request(
        `/api/staff/accounts/${created.id}/revoke-sessions`,
        {method: 'POST', headers: {cookie, origin: env.FRONTEND_URL}},
        env,
      );

      expect(res.status).toBe(200);
      expect((await list()).status).toBe(401);
    });

    it('a password reset ends the sessions issued before it', async () => {
      const email = `${emailPrefix}-reset-revokes@example.com`;
      const created = (await (
        await createAccount({role: 'general', email})
      ).json()) as {id: string};
      const token = await reissueLink(created.id, await generalStaffCookie());
      expect((await confirmReset(token, 'first-password')).status).toBe(200);
      globalThis.fetch = fetchWithoutSessionStub;
      const cookie = await realSessionCookie(email);
      const list = () =>
        app.request('/api/staff/accounts', {headers: {cookie}}, env);
      expect((await list()).status).toBe(200);

      // A second reset, as after a suspected leak. `reset_staff_password()`
      // moves `sessions_valid_from` with the password (`0020`).
      globalThis.fetch = staffSessionAwareFetch(fetchWithoutSessionStub);
      const second = await reissueLink(created.id, await generalStaffCookie());
      expect((await confirmReset(second, 'second-password')).status).toBe(200);
      globalThis.fetch = fetchWithoutSessionStub;

      expect((await list()).status).toBe(401);
    });

    it('returns 404 when revoking the sessions of an account that does not exist', async () => {
      const res = await app.request(
        '/api/staff/accounts/33333333-3333-3333-3333-333333333333/revoke-sessions',
        {
          method: 'POST',
          headers: {
            cookie: await generalStaffCookie(),
            origin: env.FRONTEND_URL,
          },
        },
        env,
      );

      expect(res.status).toBe(404);
    });

    /** Logs in as `email`'s `scope` account with `password`. */
    async function staffLogin(
      email: string,
      scope: string,
      password: string,
    ): Promise<Response> {
      return app.request(
        '/api/auth/staff/login',
        {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({email, scope, password}),
        },
        env,
      );
    }

    /** Creates an account and sets its password through the mailed link. */
    async function createWithPassword(
      body: Record<string, unknown>,
      password: string,
    ): Promise<string> {
      const res = await createAccount(body);
      expect(res.status).toBe(201);
      const {id} = (await res.json()) as {id: string};
      const token = await reissueLink(id, await generalStaffCookie());
      expect((await confirmReset(token, password)).status).toBe(200);
      return id;
    }

    // #166: a region's 最強位 and 新人王 run from one mailbox.
    it('keeps a 最強位 and a 新人王 account apart under one address', async () => {
      const email = `${emailPrefix}-both-types@example.com`;
      const saikyoiId = await createWithPassword(
        {role: 'regional', email, regionId, tournamentType: 'saikyoi'},
        'saikyoi-password',
      );
      const shinjinouId = await createWithPassword(
        {role: 'regional', email, regionId, tournamentType: 'shinjinou'},
        'shinjinou-password',
      );
      expect(shinjinouId).not.toBe(saikyoiId);

      const saikyoi = await staffLogin(email, 'saikyoi', 'saikyoi-password');
      expect(saikyoi.status).toBe(200);
      expect(
        ((await saikyoi.json()) as {tournamentType: string}).tournamentType,
      ).toBe('saikyoi');
      const shinjinou = await staffLogin(
        email,
        'shinjinou',
        'shinjinou-password',
      );
      expect(shinjinou.status).toBe(200);
      expect(
        ((await shinjinou.json()) as {tournamentType: string}).tournamentType,
      ).toBe('shinjinou');

      // Each password opens its own account only.
      expect(
        (await staffLogin(email, 'shinjinou', 'saikyoi-password')).status,
      ).toBe(401);
      expect(
        (await staffLogin(email, 'general', 'saikyoi-password')).status,
      ).toBe(401);

      // A third account of a type the address already has is still refused.
      const dup = await createAccount({
        role: 'regional',
        email,
        regionId,
        tournamentType: 'saikyoi',
      });
      expect(dup.status).toBe(409);
    });

    // #133: one mailbox, one account, whichever way the address is typed.
    it('treats an address case-insensitively', async () => {
      const lower = `${emailPrefix}-mixed-case@example.com`;
      const typed = lower
        .replace('mixed', 'Mixed')
        .replace('example', 'Example');
      await createWithPassword({role: 'general', email: typed}, 'mixed-pass');

      const [row] = await sql`
        select email from staff_accounts where email = ${lower}
      `;
      expect(row?.email).toBe(lower);
      expect(
        (await staffLogin(typed.toUpperCase(), 'general', 'mixed-pass')).status,
      ).toBe(200);
      expect(
        (await createAccount({role: 'general', email: lower})).status,
      ).toBe(409);
    });

    // #156: unlike revoking sessions, disabling shuts out someone who knows
    // the password too, until the account is enabled again.
    it('disables an account until it is enabled again', async () => {
      const email = `${emailPrefix}-disable@example.com`;
      const id = await createWithPassword(
        {role: 'regional', email, regionId, tournamentType: 'saikyoi'},
        'disable-password',
      );
      const outstanding = await reissueLink(id, await generalStaffCookie());
      const login = await staffLogin(email, 'saikyoi', 'disable-password');
      expect(login.status).toBe(200);
      const [{sessions_valid_from: before}] = await sql`
        select sessions_valid_from from staff_accounts where id = ${id}
      `;

      const res = await app.request(
        `/api/staff/accounts/${id}/disable`,
        {
          method: 'POST',
          headers: {
            cookie: await generalStaffCookie(),
            origin: env.FRONTEND_URL,
          },
        },
        env,
      );
      expect(res.status).toBe(200);

      const [after] = await sql`
        select disabled_at, sessions_valid_from from staff_accounts
        where id = ${id}
      `;
      expect(after.disabled_at).not.toBeNull();
      // Every session it had open ends along with it.
      expect(new Date(after.sessions_valid_from).getTime()).not.toBe(
        new Date(before).getTime(),
      );
      // The right password no longer opens it, ...
      expect(
        (await staffLogin(email, 'saikyoi', 'disable-password')).status,
      ).toBe(401);
      // ... the link it had outstanding is gone, ...
      expect((await confirmReset(outstanding, 'taken-over')).status).toBe(400);
      // ... and no new one can be sent.
      const reset = await app.request(
        `/api/staff/accounts/${id}/password-reset`,
        {
          method: 'POST',
          headers: {
            cookie: await generalStaffCookie(),
            origin: env.FRONTEND_URL,
          },
        },
        env,
      );
      expect(reset.status).toBe(409);

      const list = (await (
        await app.request(
          '/api/staff/accounts',
          {headers: {cookie: await generalStaffCookie()}},
          env,
        )
      ).json()) as Array<{id: string; disabledAt: string | null}>;
      expect(
        list.find(account => account.id === id)?.disabledAt,
      ).not.toBeNull();

      const enable = await app.request(
        `/api/staff/accounts/${id}/enable`,
        {
          method: 'POST',
          headers: {
            cookie: await generalStaffCookie(),
            origin: env.FRONTEND_URL,
          },
        },
        env,
      );
      expect(enable.status).toBe(200);
      // The password it had before still works.
      expect(
        (await staffLogin(email, 'saikyoi', 'disable-password')).status,
      ).toBe(200);
    });

    it("refuses a disabled account's session", async () => {
      const email = `${emailPrefix}-disable-session@example.com`;
      const created = (await (
        await createAccount({role: 'general', email})
      ).json()) as {id: string};
      globalThis.fetch = fetchWithoutSessionStub;
      const cookie = await realSessionCookie(email);
      const list = () =>
        app.request('/api/staff/accounts', {headers: {cookie}}, env);
      expect((await list()).status).toBe(200);

      // Disabled without moving `sessions_valid_from`, as a row edited by
      // hand might be: the guards must still refuse it.
      await sql`
        update staff_accounts set disabled_at = now() where id = ${created.id}
      `;

      expect((await list()).status).toBe(401);
    });
  },
);
