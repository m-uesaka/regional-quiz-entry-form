import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {Hono} from 'hono';
import {sign} from 'hono/jwt';
import type {StaffClaims} from '@regional-quiz/shared';
import type {Bindings, Env} from '../types/env';
import type {TournamentRow} from '../lib/tournaments';
import {
  closedEntryPeriodTournament,
  openEntryPeriodTournament,
  TEST_REGION_ID,
} from '../test-support/tournaments';
import {
  staffSessionAwareFetch,
  TEST_SESSIONS_VALID_FROM_MS,
} from '../test-support/staff-session';
import {requireOpenEntryPeriodOrStaff} from './entry-period';

const SESSION_SECRET = 'test-session-secret';
const OTHER_REGION_ID = '77777777-7777-7777-7777-777777777777';

// The gate resolves the tournament itself, so a resolver handed the row
// outright is all these need, and no route to mount under. Supabase is only
// reached for the staff session check, which `fetch` is stubbed to answer.
const env = {
  SESSION_SECRET,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'dummy-service-role-key',
} as Bindings;

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = staffSessionAwareFetch(originalFetch);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * An app whose one route reports what the gate left on the context.
 * @param tournament The row the resolver should answer with.
 */
function gatedApp(tournament: TournamentRow) {
  return new Hono<Env>().get(
    '/',
    requireOpenEntryPeriodOrStaff(async () => tournament),
    c => c.json({entryPeriodStaff: c.get('entryPeriodStaff') ?? null}),
  );
}

async function regionalStaffCookie(regionId: string): Promise<string> {
  const token = await sign(
    {
      sub: '88888888-8888-8888-8888-888888888888',
      role: 'regional',
      regionId,
      tournamentType: 'saikyoi',
      sessionsValidFrom: TEST_SESSIONS_VALID_FROM_MS,
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    SESSION_SECRET,
  );
  return `staff_session=${token}`;
}

describe('requireOpenEntryPeriodOrStaff (refusals)', () => {
  it('refuses a caller with no session outside the period with 403', async () => {
    const res = await gatedApp(closedEntryPeriodTournament()).request(
      '/',
      {},
      env,
    );

    expect(res.status).toBe(403);
    expect((await res.json()) as unknown).toEqual({
      error: 'entry period closed',
    });
  });

  // Told apart from the case above so the staff screens behind this gate can
  // send a staff member whose token expired mid-session back to the login
  // form, rather than to a 「権限がありません」 their account doesn't deserve.
  it('refuses a session that no longer verifies with 401', async () => {
    const res = await gatedApp(closedEntryPeriodTournament()).request(
      '/',
      {headers: {cookie: 'staff_session=not-a-valid-token'}},
      env,
    );

    expect(res.status).toBe(401);
    expect((await res.json()) as unknown).toEqual({
      error: 'staff session expired',
    });
  });

  // A revoked session is as dead as an expired one, and answered the same
  // way so the staff screens send it back to the login form.
  it('refuses a revoked session with 401', async () => {
    globalThis.fetch = staffSessionAwareFetch(
      originalFetch,
      '2026-08-25T02:00:00.000Z',
    );

    const res = await gatedApp(closedEntryPeriodTournament()).request(
      '/',
      {headers: {cookie: await regionalStaffCookie(TEST_REGION_ID)}},
      env,
    );

    expect(res.status).toBe(401);
    expect((await res.json()) as unknown).toEqual({
      error: 'staff session expired',
    });
  });

  // Out of scope as well as revoked: the session is dead whichever form it
  // is aimed at, and a 403 would leave its holder on 「エントリー期間外です」
  // with no way back to the login form.
  it("refuses a revoked session with 401 on another region's form too", async () => {
    globalThis.fetch = staffSessionAwareFetch(
      originalFetch,
      '2026-08-25T02:00:00.000Z',
    );

    const res = await gatedApp(closedEntryPeriodTournament()).request(
      '/',
      {headers: {cookie: await regionalStaffCookie(OTHER_REGION_ID)}},
      env,
    );

    expect(res.status).toBe(401);
  });

  it('answers 500, not 401, when the session cannot be checked', async () => {
    const originalConsoleError = console.error;
    console.error = () => {};
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({message: 'connection refused'}, {status: 500}),
      )) as unknown as typeof fetch;

    try {
      const res = await gatedApp(closedEntryPeriodTournament()).request(
        '/',
        {headers: {cookie: await regionalStaffCookie(TEST_REGION_ID)}},
        env,
      );

      expect(res.status).toBe(500);
    } finally {
      console.error = originalConsoleError;
    }
  });

  it('refuses a caller with no session to a paused form, saying it is paused', async () => {
    const res = await gatedApp(
      openEntryPeriodTournament({entries_paused: true}),
    ).request('/', {}, env);

    expect(res.status).toBe(403);
    expect((await res.json()) as unknown).toEqual({error: 'entries paused'});
  });

  it('still says closed for a paused form outside its period', async () => {
    const res = await gatedApp(
      closedEntryPeriodTournament({entries_paused: true}),
    ).request('/', {}, env);

    expect((await res.json()) as unknown).toEqual({
      error: 'entry period closed',
    });
  });

  it("refuses another region's staff with 403", async () => {
    const res = await gatedApp(closedEntryPeriodTournament()).request(
      '/',
      {headers: {cookie: await regionalStaffCookie(OTHER_REGION_ID)}},
      env,
    );

    expect(res.status).toBe(403);
  });
});

describe('requireOpenEntryPeriodOrStaff (context variables)', () => {
  it('leaves entryPeriodStaff unset while the entry period is open', async () => {
    const res = await gatedApp(openEntryPeriodTournament()).request(
      '/',
      {},
      env,
    );

    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({entryPeriodStaff: null});
  });

  // The claims are what tells a handler behind the gate that this is a staff
  // preview of a form that is not published yet, rather than the public
  // in-period read. Left unset, the two would be indistinguishable.
  it('lets the staff covering a paused form preview it', async () => {
    const res = await gatedApp(
      openEntryPeriodTournament({entries_paused: true}),
    ).request(
      '/',
      {headers: {cookie: await regionalStaffCookie(TEST_REGION_ID)}},
      env,
    );

    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as {entryPeriodStaff: StaffClaims | null})
        .entryPeriodStaff,
    ).toMatchObject({regionId: TEST_REGION_ID});
  });

  it('sets entryPeriodStaff for the staff let through outside the period', async () => {
    const res = await gatedApp(closedEntryPeriodTournament()).request(
      '/',
      {headers: {cookie: await regionalStaffCookie(TEST_REGION_ID)}},
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {entryPeriodStaff: StaffClaims | null};
    expect(body.entryPeriodStaff).toMatchObject({
      role: 'regional',
      regionId: TEST_REGION_ID,
    });
  });
});
