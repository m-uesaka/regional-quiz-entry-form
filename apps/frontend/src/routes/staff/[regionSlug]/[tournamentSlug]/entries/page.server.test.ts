import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {Entry, StaffClaims, Tournament} from '@regional-quiz/shared';
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

const ENTRIES: Entry[] = [
  {
    id: '00000000-0000-0000-0000-000000000004',
    tournamentId: TOURNAMENT.id,
    name: '山田太郎',
    furigana: 'ヤマダタロウ',
    displayName: '太郎',
    regulationId: '00000000-0000-0000-0000-000000000005',
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
  entries?: Entry[];
  entriesStatus?: number;
}): typeof fetch {
  return (async input => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes(`/staff/tournaments/${TOURNAMENT.id}/entries`)) {
      return new Response(JSON.stringify(options.entries ?? []), {
        status: options.entriesStatus ?? 200,
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
}): Parameters<typeof load>[0] {
  return {
    params: {
      regionSlug: 'tokyo',
      tournamentSlug: options.tournamentSlug ?? 'saikyoi',
    },
    fetch: options.fetch,
    locals: {staff: options.staff},
  } as Parameters<typeof load>[0];
}

describe('staff entries +page.server load', () => {
  it('throws 401 when there is no staff session', async () => {
    const event = buildEvent({
      fetch: fakeFetch({tournament: TOURNAMENT, entries: ENTRIES}),
      staff: null,
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 401,
    } satisfies Partial<HttpError>);
  });

  it('returns the full entry list for authorized staff', async () => {
    const event = buildEvent({
      fetch: fakeFetch({tournament: TOURNAMENT, entries: ENTRIES}),
      staff: GENERAL_STAFF,
    });

    await expect(load(event)).resolves.toEqual({
      tournament: TOURNAMENT,
      entries: ENTRIES,
    });
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
});
