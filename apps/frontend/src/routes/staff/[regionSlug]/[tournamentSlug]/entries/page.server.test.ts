import {describe, expect, it} from 'vitest';
import type {Cookies, HttpError, Redirect} from '@sveltejs/kit';
import type {Entry, StaffClaims, Tournament} from '@regional-quiz/shared';
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

const GENERAL_STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-000000000003',
  role: 'general',
  regionId: null,
  tournamentType: null,
  sessionsValidFrom: 1756085025678,
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
function fakeFetch(options: {
  tournament?: Tournament;
  tournamentOk?: boolean;
  /** The tournament lookup's status, for the refusals `tournamentOk` can't say. */
  tournamentStatus?: number;
  entries?: Entry[];
  entriesStatus?: number;
  /** Collects the staff entries request URLs. */
  entriesRequests?: URL[];
}): typeof fetch {
  return (async input => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes(`/staff/tournaments/${TOURNAMENT.id}/entries`)) {
      const requested = new URL(url, 'http://localhost');
      options.entriesRequests?.push(requested);
      const entries = options.entries ?? [];
      const page = {
        items: entries,
        total: entries.length,
        limit: 100,
        offset: Number(requested.searchParams.get('offset') ?? 0),
      };
      return new Response(JSON.stringify(page), {
        status: options.entriesStatus ?? 200,
        headers: {'Content-Type': 'application/json'},
      });
    }
    return new Response(JSON.stringify(options.tournament ?? {}), {
      status:
        options.tournamentStatus ??
        (options.tournamentOk === false ? 404 : 200),
      headers: {'Content-Type': 'application/json'},
    });
  }) as typeof fetch;
}

/**
 * A stand-in for `event.cookies`, recording the names deleted on it: a
 * session the API refuses is dropped on the way to the login screen.
 * @param deleted Collects the deleted cookie names.
 */
function fakeCookies(deleted: string[] = []): Cookies {
  return {
    delete: (name: string) => {
      deleted.push(name);
    },
  } as unknown as Cookies;
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
    locals: {staff: options.staff},
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
      fetch: fakeFetch({tournament: TOURNAMENT, entries: ENTRIES}),
      staff: null,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: LOGIN_REDIRECT,
    } satisfies Partial<Redirect>);
  });

  it('redirects to the login screen when the session expired before the API call', async () => {
    const event = buildEvent({
      fetch: fakeFetch({tournament: TOURNAMENT, entriesStatus: 401}),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: LOGIN_REDIRECT,
    } satisfies Partial<Redirect>);
  });

  it('returns the first page of entries for authorized staff', async () => {
    const event = buildEvent({
      fetch: fakeFetch({tournament: TOURNAMENT, entries: ENTRIES}),
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
    const entriesRequests: URL[] = [];
    const event = buildEvent({
      fetch: fakeFetch({
        tournament: TOURNAMENT,
        entries: ENTRIES,
        entriesRequests,
      }),
      staff: GENERAL_STAFF,
      search: '?status=waitlisted&offset=100',
    });

    await expect(load(event)).resolves.toMatchObject({
      status: 'waitlisted',
      offset: 100,
    });
    expect(entriesRequests[0].searchParams.get('status')).toBe('waitlisted');
    expect(entriesRequests[0].searchParams.get('offset')).toBe('100');
  });

  it('lists every status when the URL names an unknown one', async () => {
    const entriesRequests: URL[] = [];
    const event = buildEvent({
      fetch: fakeFetch({
        tournament: TOURNAMENT,
        entries: ENTRIES,
        entriesRequests,
      }),
      staff: GENERAL_STAFF,
      search: '?status=nope',
    });

    await expect(load(event)).resolves.toMatchObject({status: null});
    expect(entriesRequests[0].searchParams.has('status')).toBe(false);
  });

  it('throws 404 when the tournament slug is not a valid tournament type', async () => {
    const event = buildEvent({
      fetch: fakeFetch({tournament: TOURNAMENT, entries: ENTRIES}),
      staff: GENERAL_STAFF,
      tournamentSlug: 'nope',
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });

  it('throws 404 when the tournament is not found', async () => {
    const event = buildEvent({
      fetch: fakeFetch({tournamentOk: false}),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });

  it('throws 403 when staff are outside their scope', async () => {
    const event = buildEvent({
      fetch: fakeFetch({tournament: TOURNAMENT, entriesStatus: 403}),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
  });

  it('throws 502 when the staff entries request fails', async () => {
    const event = buildEvent({
      fetch: fakeFetch({tournament: TOURNAMENT, entriesStatus: 500}),
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
      fetch: fakeFetch({tournamentStatus: 403}),
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
      fetch: fakeFetch({tournamentStatus: 401}),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: LOGIN_REDIRECT,
    } satisfies Partial<Redirect>);
  });
});

describe('staff entries pause action', () => {
  /** One request the action sent. */
  interface Sent {
    method: string;
    url: string;
    body: unknown;
  }

  function pauseFetch(
    options: {status?: number; sent?: Sent[]} = {},
  ): typeof fetch {
    return (async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return Response.json(TOURNAMENT);
      }
      const body = JSON.parse(String(init?.body)) as {paused: boolean};
      options.sent?.push({method, url, body});
      const status = options.status ?? 200;
      return status >= 400
        ? Response.json({error: 'nope'}, {status})
        : Response.json({...TOURNAMENT, entriesPaused: body.paused});
    }) as typeof fetch;
  }

  function buildActionEvent(
    fetchImpl: typeof fetch,
    paused: string | null,
  ): Parameters<typeof actions.pause>[0] {
    const formData = new FormData();
    if (paused !== null) {
      formData.set('paused', paused);
    }
    return {
      params: {regionSlug: 'tokyo', tournamentSlug: 'saikyoi'},
      fetch: fetchImpl,
      cookies: fakeCookies(),
      locals: {staff: GENERAL_STAFF},
      url: new URL('http://localhost/staff/tokyo/saikyoi/entries'),
      request: {formData: async () => formData},
    } as Parameters<typeof actions.pause>[0];
  }

  it('pauses the tournament the route names', async () => {
    const sent: Sent[] = [];

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
    const sent: Sent[] = [];

    await expect(
      actions.pause(buildActionEvent(pauseFetch({sent}), 'false')),
    ).resolves.toEqual({paused: false, pauseError: null});
    expect(sent.map(s => s.body)).toEqual([{paused: false}]);
  });

  it('refuses a post without the state to set, without asking the API', async () => {
    const sent: Sent[] = [];

    await expect(
      actions.pause(buildActionEvent(pauseFetch({sent}), null)),
    ).resolves.toMatchObject({status: 400});
    expect(sent).toEqual([]);
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
