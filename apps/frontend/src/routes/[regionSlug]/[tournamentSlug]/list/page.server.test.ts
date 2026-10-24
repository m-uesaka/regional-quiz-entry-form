import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {EntryListItem} from '@regional-quiz/shared';
import {load} from './+page.server';

const ENTRIES: EntryListItem[] = [
  {displayName: '参加者A', status: 'confirmed', waitlistPosition: null},
  {displayName: '参加者B', status: 'waitlisted', waitlistPosition: 1},
];

/**
 * Builds a fake `fetch` for the single backend call `load` makes: the
 * slug-keyed entry list. The URL is matched rather than answered blindly,
 * so a regression that goes back through the entry-period-gated
 * `GET /tournaments/:regionSlug/:tournamentSlug` — which stops answering
 * this page once entries close — fails these tests instead of passing.
 */
function fakeFetch(options: {
  entries?: EntryListItem[];
  total?: number;
  status?: number;
  /** Collects every requested URL. */
  requests?: URL[];
}): typeof fetch {
  return (async input => {
    const url = typeof input === 'string' ? input : input.toString();
    if (!url.includes('/tokyo/saikyoi/entry-list')) {
      throw new Error(`unexpected request to ${url}`);
    }
    const requested = new URL(url, 'http://localhost');
    options.requests?.push(requested);
    const entries = options.entries ?? [];
    const page = {
      items: entries,
      total: options.total ?? entries.length,
      limit: 100,
      offset: Number(requested.searchParams.get('offset') ?? 0),
    };
    return new Response(JSON.stringify(page), {
      status: options.status ?? 200,
      headers: {'Content-Type': 'application/json'},
    });
  }) as typeof fetch;
}

/** Builds the partial `RequestEvent` `load` needs, cast for test use. */
function buildEvent(options: {
  fetch: typeof fetch;
  tournamentSlug?: string;
  search?: string;
}): Parameters<typeof load>[0] {
  const tournamentSlug = options.tournamentSlug ?? 'saikyoi';
  return {
    params: {regionSlug: 'tokyo', tournamentSlug},
    fetch: options.fetch,
    url: new URL(
      `http://localhost/tokyo/${tournamentSlug}/list${options.search ?? ''}`,
    ),
  } as Parameters<typeof load>[0];
}

describe('list +page.server load', () => {
  it('returns the entry list for a valid tournament', async () => {
    const event = buildEvent({fetch: fakeFetch({entries: ENTRIES})});

    await expect(load(event)).resolves.toEqual({
      entries: ENTRIES,
      total: 2,
      limit: 100,
      offset: 0,
    });
  });

  it('asks for the page the URL names and passes the total on', async () => {
    const requests: URL[] = [];
    const event = buildEvent({
      fetch: fakeFetch({entries: ENTRIES, total: 250, requests}),
      search: '?offset=200',
    });

    await expect(load(event)).resolves.toMatchObject({
      total: 250,
      offset: 200,
    });
    expect(requests[0].searchParams.get('offset')).toBe('200');
  });

  it('asks for the first page when the URL offset is invalid', async () => {
    const requests: URL[] = [];
    const event = buildEvent({
      fetch: fakeFetch({entries: ENTRIES, requests}),
      search: '?offset=-5',
    });

    await load(event);

    expect(requests[0].searchParams.get('offset')).toBe('0');
  });

  it('throws 404 when the tournament slug is not a valid tournament type', async () => {
    const event = buildEvent({
      fetch: fakeFetch({entries: ENTRIES}),
      tournamentSlug: 'nope',
    });

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });

  it('throws 404 when the tournament is not found', async () => {
    const event = buildEvent({fetch: fakeFetch({status: 404})});

    await expect(load(event)).rejects.toMatchObject({
      status: 404,
    } satisfies Partial<HttpError>);
  });

  it('throws 502 when the entry-list request fails', async () => {
    const event = buildEvent({fetch: fakeFetch({status: 500})});

    await expect(load(event)).rejects.toMatchObject({
      status: 502,
    } satisfies Partial<HttpError>);
  });
});
