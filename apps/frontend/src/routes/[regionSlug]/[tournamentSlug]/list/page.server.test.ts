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
  status?: number;
}): typeof fetch {
  return (async input => {
    const url = typeof input === 'string' ? input : input.toString();
    if (!url.includes('/tokyo/saikyoi/entry-list')) {
      throw new Error(`unexpected request to ${url}`);
    }
    return new Response(JSON.stringify(options.entries ?? []), {
      status: options.status ?? 200,
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
    const event = buildEvent({fetch: fakeFetch({entries: ENTRIES})});

    await expect(load(event)).resolves.toEqual({entries: ENTRIES});
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
