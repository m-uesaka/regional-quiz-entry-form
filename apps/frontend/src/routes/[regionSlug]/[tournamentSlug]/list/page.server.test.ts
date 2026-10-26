import {describe, expect, it} from 'vitest';
import type {HttpError} from '@sveltejs/kit';
import type {EntryListItem} from '@regional-quiz/shared';
import {dropCachedEntryList} from '$lib/server/entry-list-cache';
import {
  fakePlatform,
  TOKYO_SAIKYOI_LIST_KEY,
} from '../../../../test-support/fake-platform';
import {load} from './+page.server';

const ENTRIES: EntryListItem[] = [
  {
    displayName: '参加者A',
    status: 'confirmed',
    waitlistPosition: null,
    enteredAt: '2026-11-01T00:00:05.123456+00:00',
  },
  {
    displayName: '参加者B',
    status: 'waitlisted',
    waitlistPosition: 1,
    enteredAt: '2026-11-01T00:01:00+00:00',
  },
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
  platform?: App.Platform;
}): Parameters<typeof load>[0] {
  const tournamentSlug = options.tournamentSlug ?? 'saikyoi';
  return {
    params: {regionSlug: 'tokyo', tournamentSlug},
    fetch: options.fetch,
    platform: options.platform,
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

  describe('the Cloudflare cache (#125)', () => {
    /** The cached pages, i.e. every stored key but the list versions. */
    function pageKeys(stored: Map<string, Response>): string[] {
      return [...stored.keys()].filter(key => key.includes('?offset='));
    }

    it('stores a fetched page for 30 seconds, under the list version', async () => {
      const {platform, stored, settled} = fakePlatform();
      const event = buildEvent({
        fetch: fakeFetch({entries: ENTRIES}),
        platform,
      });

      await load(event);
      await settled();

      const version = await stored.get(TOKYO_SAIKYOI_LIST_KEY)?.text();
      expect(version).toBeTruthy();
      const [pageKey] = pageKeys(stored);
      expect(pageKey).toBe(
        `http://localhost/__cache/entry-list/tokyo/saikyoi/${version}?offset=0`,
      );
      const page = stored.get(pageKey);
      expect(page?.headers.get('cache-control')).toBe('public, max-age=30');
      expect(await page?.json()).toEqual({
        items: ENTRIES,
        total: 2,
        limit: 100,
        offset: 0,
      });
    });

    it('answers from the cache without calling the backend', async () => {
      const {platform, settled} = fakePlatform();
      await load(buildEvent({fetch: fakeFetch({entries: ENTRIES}), platform}));
      await settled();

      const event = buildEvent({
        fetch: (() => {
          throw new Error('the backend was called on a cache hit');
        }) as typeof fetch,
        platform,
      });

      await expect(load(event)).resolves.toEqual({
        entries: ENTRIES,
        total: 2,
        limit: 100,
        offset: 0,
      });
    });

    it('keeps pages apart', async () => {
      const {platform, settled} = fakePlatform();
      await load(buildEvent({fetch: fakeFetch({entries: ENTRIES}), platform}));
      await settled();

      const requests: URL[] = [];
      await load(
        buildEvent({
          fetch: fakeFetch({entries: ENTRIES, total: 250, requests}),
          search: '?offset=100',
          platform,
        }),
      );

      expect(requests).toHaveLength(1);
    });

    it('keeps tournaments apart', async () => {
      const {platform, settled} = fakePlatform();
      await load(buildEvent({fetch: fakeFetch({entries: ENTRIES}), platform}));
      await settled();

      // A different tournament type must miss and reach the backend.
      const event = buildEvent({
        fetch: fakeFetch({entries: ENTRIES}),
        tournamentSlug: 'shinjinou',
        platform,
      });

      await expect(load(event)).rejects.toThrow(/unexpected request/);
    });

    it('does not cache an offset the pager never links to', async () => {
      const {platform, stored, settled} = fakePlatform();
      const event = buildEvent({
        fetch: fakeFetch({entries: ENTRIES, total: 250}),
        search: '?offset=150',
        platform,
      });

      await load(event);
      await settled();

      expect(stored.size).toBe(0);
    });

    it('does not cache a failed read', async () => {
      const {platform, stored, settled} = fakePlatform();
      const event = buildEvent({fetch: fakeFetch({status: 500}), platform});

      await expect(load(event)).rejects.toMatchObject({status: 502});
      await settled();

      expect(pageKeys(stored)).toEqual([]);
    });

    it('reaches the backend again once the list is dropped', async () => {
      const {platform, settled} = fakePlatform();
      await load(buildEvent({fetch: fakeFetch({entries: ENTRIES}), platform}));
      await settled();

      await dropCachedEntryList(platform, 'http://localhost', {
        regionSlug: 'tokyo',
        type: 'saikyoi',
      });
      const requests: URL[] = [];
      await load(
        buildEvent({fetch: fakeFetch({entries: ENTRIES, requests}), platform}),
      );

      expect(requests).toHaveLength(1);
    });
  });
});
