import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {sign} from 'hono/jwt';
import type {Bindings} from '../types/env';
import {app} from '../index';
import {PERMISSIVE_PLATFORM_BINDINGS} from '../test-support/bindings';
import {
  staffSessionAwareFetch,
  TEST_SESSIONS_VALID_FROM_MS,
} from '../test-support/staff-session';
import {
  openEntryPeriodTournament,
  TEST_REGION_ID,
} from '../test-support/tournaments';

const SESSION_SECRET = 'test-session-secret';
const OTHER_REGION_ID = '77777777-7777-7777-7777-777777777777';
const TOURNAMENT = openEntryPeriodTournament();

const env: Bindings = {
  ...PERMISSIVE_PLATFORM_BINDINGS,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'dummy-service-role-key',
  MAIL_API_KEY: 'dummy-mail-api-key',
  GOOGLE_SHEETS_API_KEY: 'dummy-google-sheets-api-key',
  MAIL_FROM_ADDRESS: 'entry@example.com',
  FRONTEND_URL: 'https://entry.example.com',
  SESSION_SECRET,
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function staffCookie(
  claims: {role: 'general'} | {role: 'regional'; regionId: string},
): Promise<string> {
  const token = await sign(
    {
      sub: '88888888-8888-8888-8888-888888888888',
      regionId: null,
      tournamentType: claims.role === 'regional' ? 'saikyoi' : null,
      ...claims,
      sessionsValidFrom: TEST_SESSIONS_VALID_FROM_MS,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

describe('PUT /staff/tournaments/:tournamentId/entry-pause (mocked Supabase)', () => {
  let updates: unknown[] = [];

  beforeEach(() => {
    updates = [];
    // The guard's scope read is a GET; the pause itself a PATCH, answered
    // with the row as it stands after the update.
    globalThis.fetch = staffSessionAwareFetch((async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as {
          entries_paused: boolean;
        };
        updates.push(body);
        return Response.json([{...TOURNAMENT, ...body}]);
      }
      if (String(input).includes('/rest/v1/tournaments')) {
        return Response.json([TOURNAMENT]);
      }
      return new Response(null, {status: 500});
    }) as unknown as typeof fetch);
  });

  async function putPause(body: unknown, cookie: string): Promise<Response> {
    return app.request(
      `/api/staff/tournaments/${TOURNAMENT.id}/entry-pause`,
      {
        method: 'PUT',
        headers: {cookie, 'content-type': 'application/json'},
        body: JSON.stringify(body),
      },
      env,
    );
  }

  it('pauses a tournament for the regional staff who cover it', async () => {
    const res = await putPause(
      {paused: true},
      await staffCookie({role: 'regional', regionId: TEST_REGION_ID}),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as {entriesPaused: boolean}).entriesPaused).toBe(
      true,
    );
    expect(updates).toEqual([{entries_paused: true}]);
  });

  it('resumes a tournament for general staff', async () => {
    const res = await putPause(
      {paused: false},
      await staffCookie({role: 'general'}),
    );

    expect(res.status).toBe(200);
    expect(updates).toEqual([{entries_paused: false}]);
  });

  it("refuses another region's staff without writing anything", async () => {
    const res = await putPause(
      {paused: true},
      await staffCookie({role: 'regional', regionId: OTHER_REGION_ID}),
    );

    expect(res.status).toBe(403);
    expect(updates).toEqual([]);
  });

  it('refuses a body without the state to set', async () => {
    const res = await putPause({}, await staffCookie({role: 'general'}));

    expect(res.status).toBe(400);
    expect(updates).toEqual([]);
  });
});
