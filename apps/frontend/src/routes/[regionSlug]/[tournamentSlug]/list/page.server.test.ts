import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {EntryListItem, Tournament} from '@regional-quiz/shared';
import {load} from './+page.server';

const TOURNAMENT: Tournament = {
  id: '00000000-0000-0000-0000-000000000001',
  regionId: '00000000-0000-0000-0000-000000000002',
  type: 'saikyoi',
  name: 'テスト大会',
  capacity: null,
  entryOpensAt: '2020-01-01T00:00:00.000Z',
  entryClosesAt: '2020-02-01T00:00:00.000Z',
};

const ENTRIES: EntryListItem[] = [
  {displayName: '参加者A', status: 'confirmed', waitlistPosition: null},
  {displayName: '参加者B', status: 'waitlisted', waitlistPosition: 1},
];

/**
 * Builds a fake `fetch` that dispatches by URL path, mirroring the two
 * backend calls `load` makes (tournament lookup, then entry-list).
 */
function fakeFetch(options: {
  tournament?: Tournament;
  tournamentOk?: boolean;
  entries?: EntryListItem[];
  entriesOk?: boolean;
}): typeof fetch {
  return (async input => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/entry-list')) {
      return new Response(JSON.stringify(options.entries ?? []), {
        status: options.entriesOk === false ? 502 : 200,
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
  tournamentSlug?: string;
}): Parameters<typeof load>[0] {
  return {
    params: {
      regionSlug: 'tokyo',
      tournamentSlug: options.tournamentSlug ?? 'saikyoi',
    },
    fetch: options.fetch,
  } as Parameters<typeof load>[0];
}

describe('list +page.server load', () => {
  it('returns the entry list for a valid tournament', async () => {
    const event = buildEvent({
      fetch: fakeFetch({tournament: TOURNAMENT, entries: ENTRIES}),
    });

    await expect(load(event)).resolves.toEqual({entries: ENTRIES});
  });

  it('throws 404 when the tournament slug is not a valid tournament type', async () => {
    const event = buildEvent({
      fetch: fakeFetch({tournament: TOURNAMENT, entries: ENTRIES}),
      tournamentSlug: 'nope',
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });

  it('throws 404 when the tournament is not found', async () => {
    const event = buildEvent({
      fetch: fakeFetch({tournamentOk: false}),
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });

  it('throws 502 when the entry-list request fails', async () => {
    const event = buildEvent({
      fetch: fakeFetch({tournament: TOURNAMENT, entriesOk: false}),
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });
});
