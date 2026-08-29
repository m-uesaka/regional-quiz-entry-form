import {describe, expect, it} from 'vitest';
import type {HttpError, Redirect} from '@sveltejs/kit';
import type {
  StaffClaims,
  StaffEntryDetail,
  Tournament,
} from '@regional-quiz/shared';
import {load} from './+page.server';

const TOURNAMENT: Tournament = {
  id: '00000000-0000-0000-0000-000000000001',
  regionId: '00000000-0000-0000-0000-000000000002',
  type: 'saikyoi',
  name: 'テスト大会',
  capacity: null,
  entryOpensAt: '2020-01-01T00:00:00.000Z',
  entryClosesAt: '2099-01-01T00:00:00.000Z',
};

const GENERAL_STAFF: StaffClaims = {
  sub: '00000000-0000-0000-0000-000000000003',
  role: 'general',
  regionId: null,
  tournamentType: null,
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
function fakeFetch(options: {
  tournament?: Tournament;
  tournamentOk?: boolean;
  entry?: StaffEntryDetail;
  entryStatus?: number;
}): typeof fetch {
  return (async input => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/staff/entries/')) {
      return new Response(JSON.stringify(options.entry ?? {}), {
        status: options.entryStatus ?? 200,
        headers: {'Content-Type': 'application/json'},
      });
    }
    return new Response(JSON.stringify(options.tournament ?? {}), {
      status: options.tournamentOk === false ? 404 : 200,
      headers: {'Content-Type': 'application/json'},
    });
  }) as typeof fetch;
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
    locals: {staff: options.staff},
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
      fetch: fakeFetch({tournament: TOURNAMENT, entry: ENTRY}),
      staff: null,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: LOGIN_REDIRECT,
    } satisfies Partial<Redirect>);
  });

  it('redirects to the login screen when the session expired before the API call', async () => {
    const event = buildEvent({
      fetch: fakeFetch({
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
      fetch: fakeFetch({tournament: TOURNAMENT, entry: ENTRY}),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).resolves.toEqual({entry: ENTRY});
  });

  it('throws 404 when the tournament slug is not a valid tournament type', async () => {
    const event = buildEvent({
      fetch: fakeFetch({tournament: TOURNAMENT, entry: ENTRY}),
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

  it('throws 404 when the entry is not found', async () => {
    const event = buildEvent({
      fetch: fakeFetch({
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
      fetch: fakeFetch({
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

  it('throws 404 when the entry belongs to a different tournament', async () => {
    const entryFromOtherTournament: StaffEntryDetail = {
      ...ENTRY,
      tournamentId: '00000000-0000-0000-0000-000000000099',
    };
    const event = buildEvent({
      fetch: fakeFetch({
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
