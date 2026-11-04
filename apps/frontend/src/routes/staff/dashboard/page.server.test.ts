import {describe, expect, it} from 'vitest';
import type {HttpError, Redirect} from '@sveltejs/kit';
import type {
  DashboardTournamentSummary,
  StaffClaims,
} from '@regional-quiz/shared';
import {fakeCookies} from '../../../test-support/fake-cookies';
import {
  fakeFetch,
  type RecordedRequest,
} from '../../../test-support/fake-fetch';
import {
  GENERAL_STAFF,
  REGIONAL_STAFF,
  staffLocals,
} from '../../../test-support/staff-locals';
import {load} from './+page.server';

const SUMMARIES: DashboardTournamentSummary[] = [
  {
    tournamentId: '00000000-0000-0000-0000-000000000004',
    tournamentName: '東京大会',
    tournamentType: 'saikyoi',
    regionId: '00000000-0000-0000-0000-000000000003',
    regionSlug: 'tokyo',
    regionName: '東京',
    capacity: 100,
    confirmedCount: 80,
    waitlistedCount: 12,
    pendingVerificationCount: 3,
    cancelledCount: 5,
  },
];

/** Builds a fake `fetch` answering the dashboard API as given. */
function fakeApi(status = 200, body: unknown = SUMMARIES): typeof fetch {
  return fakeFetch([
    {method: 'GET', url: '/api/staff/dashboard', status, body},
  ]);
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildEvent(options: {
  fetch: typeof fetch;
  staff: StaffClaims | null;
  deletedCookies?: string[];
}): Parameters<typeof load>[0] {
  return {
    fetch: options.fetch,
    cookies: fakeCookies(options.deletedCookies),
    locals: staffLocals(options.staff),
    url: new URL('http://localhost/staff/dashboard'),
  } as Parameters<typeof load>[0];
}

describe('staff dashboard +page.server load', () => {
  it('redirects to the login screen when there is no staff session', async () => {
    const event = buildEvent({fetch: fakeApi(), staff: null});

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: '/staff/login?redirectTo=%2Fstaff%2Fdashboard',
    } satisfies Partial<Redirect>);
  });

  it('throws 403 for regional staff without calling the API', async () => {
    const requests: RecordedRequest[] = [];
    const event = buildEvent({
      fetch: fakeFetch([], requests),
      staff: REGIONAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
    expect(requests).toEqual([]);
  });

  it('returns every region summary for general staff', async () => {
    const event = buildEvent({fetch: fakeApi(), staff: GENERAL_STAFF});

    await expect(load(event)).resolves.toEqual({summaries: SUMMARIES});
  });

  it('redirects to the login screen when the session expired before the API call', async () => {
    const deletedCookies: string[] = [];
    const event = buildEvent({
      fetch: fakeApi(401),
      staff: GENERAL_STAFF,
      deletedCookies,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: '/staff/login?redirectTo=%2Fstaff%2Fdashboard',
    } satisfies Partial<Redirect>);
    // The cookie still verifies here -- the API refused it because the
    // account's sessions were revoked -- so it is dropped rather than left
    // to pass for a session on every page that only checks the signature.
    expect(deletedCookies).toEqual(['staff_session']);
  });

  it('throws 403 when the API rejects the session as out of scope', async () => {
    const event = buildEvent({fetch: fakeApi(403), staff: GENERAL_STAFF});

    await expect(load(event)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
  });

  it('throws 502 when the dashboard request fails', async () => {
    const event = buildEvent({fetch: fakeApi(500), staff: GENERAL_STAFF});

    await expect(load(event)).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });
});
