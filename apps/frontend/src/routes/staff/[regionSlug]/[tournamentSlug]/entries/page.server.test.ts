import {describe, expect, it} from 'vitest';
import type {HttpError, Redirect} from '@sveltejs/kit';
import type {Entry, StaffClaims, Tournament} from '@regional-quiz/shared';
import {fakeCookies} from '../../../../../test-support/fake-cookies';
import {
  fakeFetch,
  type FakeRoute,
  type RecordedRequest,
} from '../../../../../test-support/fake-fetch';
import {jsonResponse} from '../../../../../test-support/json-response';
import {pagedRoute} from '../../../../../test-support/paged-route';
import {
  GENERAL_STAFF,
  staffLocals,
} from '../../../../../test-support/staff-locals';
import {actions, load} from './+page.server';

const TOURNAMENT: Tournament = {
  id: '00000000-0000-0000-0000-000000000001',
  regionId: '00000000-0000-0000-0000-000000000002',
  type: 'saikyoi',
  name: 'テスト大会',
  capacity: null,
  entryOpensAt: '2020-01-01T00:00:00.000Z',
  entryClosesAt: '2099-01-01T00:00:00.000Z',
  entriesPaused: false,
};

const ENTRIES: Entry[] = [
  {
    id: '00000000-0000-0000-0000-000000000004',
    tournamentId: TOURNAMENT.id,
    name: '山田太郎',
    furigana: 'ヤマダタロウ',
    displayName: '太郎',
    email: 'taro@example.com',
    regulationIds: ['00000000-0000-0000-0000-000000000005'],
    regulationLabels: ['一般の部'],
    freeText: null,
    customFieldValues: {},
    status: 'confirmed',
    waitlistPosition: null,
  },
];

/**
 * Builds a fake `fetch` that dispatches by URL path, mirroring the two
 * backend calls `load` makes (tournament lookup, then staff entries).
 */
function fakeApi(options: {
  tournament?: Tournament;
  tournamentOk?: boolean;
  /** The tournament lookup's status, for the refusals `tournamentOk` can't say. */
  tournamentStatus?: number;
  entries?: Entry[];
  entriesStatus?: number;
  /** Collects every request sent, the tournament lookup included. */
  requests?: RecordedRequest[];
}): typeof fetch {
  return fakeFetch(
    [
      pagedRoute(
        `/api/staff/tournaments/${TOURNAMENT.id}/entries`,
        options.entries ?? [],
        {status: options.entriesStatus},
      ),
      {
        method: 'GET',
        url: /^\/api\/tournaments\/tokyo\/saikyoi$/,
        status:
          options.tournamentStatus ??
          (options.tournamentOk === false ? 404 : 200),
        body: options.tournament ?? {},
      },
    ],
    options.requests,
  );
}

/** The query of the staff entries request among `requests`. */
function entriesQuery(requests: RecordedRequest[]): URLSearchParams {
  const request = requests.find(r => r.url.includes('/entries'));
  return new URL(request?.url ?? '', 'http://localhost').searchParams;
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildEvent(options: {
  fetch: typeof fetch;
  staff: StaffClaims | null;
  tournamentSlug?: string;
  search?: string;
}): Parameters<typeof load>[0] {
  const tournamentSlug = options.tournamentSlug ?? 'saikyoi';
  return {
    params: {regionSlug: 'tokyo', tournamentSlug},
    fetch: options.fetch,
    cookies: fakeCookies(),
    locals: staffLocals(options.staff),
    url: new URL(
      `http://localhost/staff/tokyo/${tournamentSlug}/entries${options.search ?? ''}`,
    ),
  } as Parameters<typeof load>[0];
}

const LOGIN_REDIRECT =
  '/staff/login?redirectTo=%2Fstaff%2Ftokyo%2Fsaikyoi%2Fentries';

describe('staff entries +page.server load', () => {
  it('redirects to the login screen when there is no staff session', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournament: TOURNAMENT, entries: ENTRIES}),
      staff: null,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: LOGIN_REDIRECT,
    } satisfies Partial<Redirect>);
  });

  it('redirects to the login screen when the session expired before the API call', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournament: TOURNAMENT, entriesStatus: 401}),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: LOGIN_REDIRECT,
    } satisfies Partial<Redirect>);
  });

  it('returns the first page of entries for authorized staff', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournament: TOURNAMENT, entries: ENTRIES}),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).resolves.toEqual({
      tournament: TOURNAMENT,
      entries: ENTRIES,
      total: 1,
      limit: 100,
      offset: 0,
      status: null,
    });
  });

  it('passes the status filter and the offset on to the backend', async () => {
    const requests: RecordedRequest[] = [];
    const event = buildEvent({
      fetch: fakeApi({
        tournament: TOURNAMENT,
        entries: ENTRIES,
        requests,
      }),
      staff: GENERAL_STAFF,
      search: '?status=waitlisted&offset=100',
    });

    await expect(load(event)).resolves.toMatchObject({
      status: 'waitlisted',
      offset: 100,
    });
    expect(entriesQuery(requests).get('status')).toBe('waitlisted');
    expect(entriesQuery(requests).get('offset')).toBe('100');
  });

  it('lists every status when the URL names an unknown one', async () => {
    const requests: RecordedRequest[] = [];
    const event = buildEvent({
      fetch: fakeApi({
        tournament: TOURNAMENT,
        entries: ENTRIES,
        requests,
      }),
      staff: GENERAL_STAFF,
      search: '?status=nope',
    });

    await expect(load(event)).resolves.toMatchObject({status: null});
    expect(entriesQuery(requests).has('status')).toBe(false);
  });

  it('throws 404 when the tournament slug is not a valid tournament type', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournament: TOURNAMENT, entries: ENTRIES}),
      staff: GENERAL_STAFF,
      tournamentSlug: 'nope',
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });

  it('throws 404 when the tournament is not found', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournamentOk: false}),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });

  it('throws 403 when staff are outside their scope', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournament: TOURNAMENT, entriesStatus: 403}),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
  });

  it('throws 502 when the staff entries request fails', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournament: TOURNAMENT, entriesStatus: 500}),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });

  // Outside the entry period the backend hands the tournament only to the
  // staff who cover it, so an out-of-scope account is refused on that read
  // rather than on the entries read behind it.
  it('throws 403 when the tournament read is refused as out of scope', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournamentStatus: 403}),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
  });

  // The same read answers 401 when the session died between the claims
  // check above and the request landing -- an account that still covers
  // this tournament, so it earns the login screen and not that 403.
  it('redirects to the login screen when the tournament read reports an expired session', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournamentStatus: 401}),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: LOGIN_REDIRECT,
    } satisfies Partial<Redirect>);
  });
});

describe('staff entries pause action', () => {
  function pauseFetch(
    options: {status?: number; sent?: RecordedRequest[]} = {},
  ): typeof fetch {
    const status = options.status ?? 200;
    const match = {
      method: 'PUT',
      url: `/api/staff/tournaments/${TOURNAMENT.id}/entry-pause`,
    };
    const answer: FakeRoute =
      status >= 400
        ? {...match, status, body: {error: 'nope'}}
        : {
            ...match,
            respond: ({body}) =>
              jsonResponse({
                ...TOURNAMENT,
                entriesPaused: (body as {paused: boolean}).paused,
              }),
          };
    return fakeFetch([answer], options.sent);
  }

  function buildActionEvent(
    fetchImpl: typeof fetch,
    paused: string | null,
    tournamentId: string | null = TOURNAMENT.id,
  ): Parameters<typeof actions.pause>[0] {
    const formData = new FormData();
    if (paused !== null) {
      formData.set('paused', paused);
    }
    if (tournamentId !== null) {
      formData.set('tournamentId', tournamentId);
    }
    return {
      params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
      fetch: fetchImpl,
      cookies: fakeCookies(),
      locals: staffLocals(GENERAL_STAFF),
      url: new URL('http://localhost/staff/tokyo/saikyoi/entries'),
      request: {formData: async () => formData},
    } as Parameters<typeof actions.pause>[0];
  }

  it('pauses the tournament the route names', async () => {
    const sent: RecordedRequest[] = [];

    await expect(
      actions.pause(buildActionEvent(pauseFetch({sent}), 'true')),
    ).resolves.toEqual({paused: true, pauseError: null});
    expect(sent).toEqual([
      {
        method: 'PUT',
        url: `/api/staff/tournaments/${TOURNAMENT.id}/entry-pause`,
        body: {paused: true},
      },
    ]);
  });

  it('resumes it', async () => {
    const sent: RecordedRequest[] = [];

    await expect(
      actions.pause(buildActionEvent(pauseFetch({sent}), 'false')),
    ).resolves.toEqual({paused: false, pauseError: null});
    expect(sent.map(s => s.body)).toEqual([{paused: false}]);
  });

  it('refuses a post without the state to set, without asking the API', async () => {
    const sent: RecordedRequest[] = [];

    await expect(
      actions.pause(buildActionEvent(pauseFetch({sent}), null)),
    ).resolves.toMatchObject({status: 400});
    expect(sent).toEqual([]);
  });

  it('refuses a post without a tournament id, without asking the API', async () => {
    const sent: RecordedRequest[] = [];

    await expect(
      actions.pause(buildActionEvent(pauseFetch({sent}), 'true', 'nope')),
    ).resolves.toMatchObject({status: 400});
    expect(sent).toEqual([]);
  });

  it('reports a tournament that has since been removed', async () => {
    await expect(
      actions.pause(buildActionEvent(pauseFetch({status: 404}), 'true')),
    ).resolves.toMatchObject({
      status: 404,
      data: {pauseError: '大会が見つかりません'},
    });
  });

  it('says a refused permission is one', async () => {
    await expect(
      actions.pause(buildActionEvent(pauseFetch({status: 403}), 'true')),
    ).resolves.toMatchObject({
      status: 403,
      data: {
        pauseError: 'この大会のエントリー受付を操作する権限がありません',
      },
    });
  });

  it('reports any other failure', async () => {
    await expect(
      actions.pause(buildActionEvent(pauseFetch({status: 500}), 'false')),
    ).resolves.toMatchObject({
      status: 502,
      data: {pauseError: 'エントリー受付の再開に失敗しました'},
    });
  });
});
