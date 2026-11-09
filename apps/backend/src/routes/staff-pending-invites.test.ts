import {afterEach, describe, expect, it} from 'bun:test';
import {sign} from 'hono/jwt';
import {app} from '../index';
import {hashPassword, UNUSABLE_PASSWORD_HASH} from '../lib/password';
import {testBindings} from '../test-support/bindings';
import {
  staffSessionAwareFetch,
  TEST_SESSIONS_VALID_FROM_MS,
} from '../test-support/staff-session';

const ENV = testBindings();
const STAFF_ID = '88888888-8888-8888-8888-888888888888';
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function staffCookie(): Promise<string> {
  const token = await sign(
    {
      sub: STAFF_ID,
      role: 'regional',
      regionId: '11111111-1111-1111-1111-111111111111',
      tournamentType: 'saikyoi',
      sessionsValidFrom: TEST_SESSIONS_VALID_FROM_MS,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    ENV.SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

/**
 * Answers the caller's own account read with `account` and the read of the
 * address's other accounts with `others` (or `othersStatus`), recording the
 * URLs of both.
 */
function stubAccounts(options: {
  account: Record<string, unknown> | null;
  others?: Array<Record<string, unknown>>;
  othersStatus?: number;
}): URL[] {
  const urls: URL[] = [];
  globalThis.fetch = staffSessionAwareFetch(((input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    urls.push(url);
    if (url.searchParams.get('id') === `eq.${STAFF_ID}`) {
      return Promise.resolve(
        Response.json(options.account ? [options.account] : []),
      );
    }
    const status = options.othersStatus ?? 200;
    return Promise.resolve(
      status === 200
        ? Response.json(options.others ?? [])
        : Response.json({message: 'boom'}, {status}),
    );
  }) as typeof fetch);
  return urls;
}

async function get(): Promise<Response> {
  return app.request(
    '/api/staff/pending-invites',
    {headers: {cookie: await staffCookie()}},
    ENV,
  );
}

describe('GET /api/staff/pending-invites', () => {
  it("names the address's other accounts still waiting on their invite", async () => {
    const urls = stubAccounts({
      account: {email: 'staff@example.com'},
      others: [
        {tournament_type: null, password_hash: UNUSABLE_PASSWORD_HASH},
        {tournament_type: 'shinjinou', password_hash: UNUSABLE_PASSWORD_HASH},
      ],
    });

    const res = await get();

    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({
      scopes: ['shinjinou', 'general'],
    });
    const lookup = urls[urls.length - 1];
    expect(lookup.searchParams.get('email')).toBe('eq.staff@example.com');
    expect(lookup.searchParams.get('id')).toBe(`neq.${STAFF_ID}`);
    expect(lookup.searchParams.get('disabled_at')).toBe('is.null');
  });

  it('leaves out the accounts whose password is already set', async () => {
    stubAccounts({
      account: {email: 'staff@example.com'},
      others: [
        {
          tournament_type: 'shinjinou',
          password_hash: await hashPassword('another-password'),
        },
      ],
    });

    expect((await (await get()).json()) as unknown).toEqual({scopes: []});
  });

  it('answers nothing pending for an account deleted after the session check', async () => {
    stubAccounts({account: null});

    expect((await (await get()).json()) as unknown).toEqual({scopes: []});
  });

  it('answers 500 when the other accounts cannot be read', async () => {
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      stubAccounts({account: {email: 'staff@example.com'}, othersStatus: 500});

      expect((await get()).status).toBe(500);
    } finally {
      console.error = originalConsoleError;
    }
  });

  it('refuses a request without a staff session', async () => {
    const res = await app.request('/api/staff/pending-invites', {}, ENV);

    expect(res.status).toBe(401);
  });
});
