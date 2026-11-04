import {describe, expect, it} from 'vitest';
import type {HttpError, Redirect} from '@sveltejs/kit';
import type {
  StaffClaims,
  StaffEntryDetail,
  Tournament,
} from '@regional-quiz/shared';
import {fakeCookies} from '../../../../../../test-support/fake-cookies';
import {fakeFetch} from '../../../../../../test-support/fake-fetch';
import {
  GENERAL_STAFF,
  staffLocals,
} from '../../../../../../test-support/staff-locals';
import {load} from './+page.server';

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

const ENTRY: StaffEntryDetail = {
  id: '00000000-0000-0000-0000-000000000004',
  tournamentId: TOURNAMENT.id,
  name: '山田太郎',
  furigana: 'ヤマダタロウ',
  displayName: '太郎',
  email: 'taro@example.com',
  regulationIds: ['00000000-0000-0000-0000-000000000005'],
  regulationLabels: ['一般の部'],
  freeText: '自由記述',
  customFieldValues: {},
  status: 'confirmed',
  waitlistPosition: null,
  formFieldDefs: [],
};

/**
 * Builds a fake `fetch` that dispatches by URL path, mirroring the two
 * backend calls `load` makes (tournament lookup, then entry detail).
 */
function fakeApi(options: {
  tournament?: Tournament;
  tournamentOk?: boolean;
  /** The tournament lookup's status, for the refusals `tournamentOk` can't say. */
  tournamentStatus?: number;
  entry?: StaffEntryDetail;
  entryStatus?: number;
}): typeof fetch {
  return fakeFetch([
    {
      method: 'GET',
      url: `/api/staff/entries/${ENTRY.id}`,
      status: options.entryStatus ?? 200,
      body: options.entry ?? {},
    },
    {
      method: 'GET',
      url: /^\/api\/tournaments\/tokyo\/saikyoi$/,
      status:
        options.tournamentStatus ??
        (options.tournamentOk === false ? 404 : 200),
      body: options.tournament ?? {},
    },
  ]);
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildEvent(options: {
  fetch: typeof fetch;
  staff: StaffClaims | null;
  tournamentSlug?: string;
  entryId?: string;
}): Parameters<typeof load>[0] {
  const tournamentSlug = options.tournamentSlug ?? 'saikyoi';
  const entryId = options.entryId ?? ENTRY.id;
  return {
    params: {regionSlug: 'tokyo', tournamentSlug, entryId},
    fetch: options.fetch,
    cookies: fakeCookies(),
    locals: staffLocals(options.staff),
    url: new URL(
      `http://localhost/staff/tokyo/${tournamentSlug}/entries/${entryId}`,
    ),
  } as Parameters<typeof load>[0];
}

const LOGIN_REDIRECT = `/staff/login?redirectTo=${encodeURIComponent(
  `/staff/tokyo/saikyoi/entries/${ENTRY.id}`,
)}`;

describe('staff entry detail +page.server load', () => {
  it('redirects to the login screen when there is no staff session', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournament: TOURNAMENT, entry: ENTRY}),
      staff: null,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: LOGIN_REDIRECT,
    } satisfies Partial<Redirect>);
  });

  it('redirects to the login screen when the session expired before the API call', async () => {
    const event = buildEvent({
      fetch: fakeApi({
        tournament: TOURNAMENT,
        entry: {error: 'unauthorized'} as unknown as StaffEntryDetail,
        entryStatus: 401,
      }),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: LOGIN_REDIRECT,
    } satisfies Partial<Redirect>);
  });

  it('returns the entry for authorized staff', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournament: TOURNAMENT, entry: ENTRY}),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).resolves.toEqual({entry: ENTRY});
  });

  it('throws 404 when the tournament slug is not a valid tournament type', async () => {
    const event = buildEvent({
      fetch: fakeApi({tournament: TOURNAMENT, entry: ENTRY}),
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

  it('throws 404 when the entry is not found', async () => {
    const event = buildEvent({
      fetch: fakeApi({
        tournament: TOURNAMENT,
        entry: {error: 'entry not found'} as unknown as StaffEntryDetail,
        entryStatus: 404,
      }),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });

  it('throws 403 when staff are outside their scope', async () => {
    const event = buildEvent({
      fetch: fakeApi({
        tournament: TOURNAMENT,
        entry: {error: 'forbidden'} as unknown as StaffEntryDetail,
        entryStatus: 403,
      }),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 403,
    } satisfies Partial<HttpError>);
  });

  // Outside the entry period the backend hands the tournament only to the
  // staff who cover it, so an out-of-scope account is refused on that read
  // rather than on the entry read behind it.
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

  it('throws 404 when the entry belongs to a different tournament', async () => {
    const entryFromOtherTournament: StaffEntryDetail = {
      ...ENTRY,
      tournamentId: '00000000-0000-0000-0000-000000000099',
    };
    const event = buildEvent({
      fetch: fakeApi({
        tournament: TOURNAMENT,
        entry: entryFromOtherTournament,
      }),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });
});
