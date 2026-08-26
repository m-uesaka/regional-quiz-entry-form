import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {
  DashboardTournamentSummary,
  StaffClaims,
} from '@regional-quiz/shared';
import {load} from './+page.server';

const GENERAL_STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-000000000001',
  role: 'general',
  regionId: null,
  tournamentType: null,
};

const REGIONAL_STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-000000000002',
  role: 'regional',
  regionId: '00000000-0000-0000-0000-000000000003',
  tournamentType: 'saikyoi',
};

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

function fakeFetch(status = 200, body: unknown = SUMMARIES): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: {'Content-Type': 'application/json'},
    })) as typeof fetch;
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildEvent(options: {
  fetch: typeof fetch;
  staff: StaffClaims | null;
}): Parameters<typeof load>[0] {
  return {
    fetch: options.fetch,
    locals: {staff: options.staff},
  } as Parameters<typeof load>[0];
}

describe('staff dashboard +page.server load', () => {
  it('throws 401 when there is no staff session', async () => {
    const event = buildEvent({fetch: fakeFetch(), staff: null});

    await expect(load(event)).rejects.toMatchObject({
      status: 401,
    } satisfies Partial<HttpError>);
  });

  it('throws 403 for regional staff without calling the API', async () => {
    let called = false;
    const event = buildEvent({
      fetch: (async () => {
        called = true;
        return new Response('[]');
      }) as typeof fetch,
      staff: REGIONAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
    expect(called).toBe(false);
  });

  it('returns every region summary for general staff', async () => {
    const event = buildEvent({fetch: fakeFetch(), staff: GENERAL_STAFF});

    await expect(load(event)).resolves.toEqual({summaries: SUMMARIES});
  });

  it('throws 401 when the session expired before the API call', async () => {
    const event = buildEvent({fetch: fakeFetch(401), staff: GENERAL_STAFF});

    await expect(load(event)).rejects.toMatchObject({
      status: 401,
    } satisfies Partial<HttpError>);
  });

  it('throws 403 when the API rejects the session as out of scope', async () => {
    const event = buildEvent({fetch: fakeFetch(403), staff: GENERAL_STAFF});

    await expect(load(event)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
  });

  it('throws 502 when the dashboard request fails', async () => {
    const event = buildEvent({fetch: fakeFetch(500), staff: GENERAL_STAFF});

    await expect(load(event)).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });
});
