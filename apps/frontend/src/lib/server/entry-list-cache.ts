import {
  PAGE_SIZE_DEFAULT,
  type EntryListItem,
  type Page,
  type TournamentType,
} from '@regional-quiz/shared';

/**
 * How long a fetched page of a public entry list is served from the
 * Cloudflare cache (#125).
 *
 * The list is read most right before the deadline, and everyone reads the
 * same thing, so this much staleness buys back the Worker → Supabase
 * round-trips for every render in between. The writes this site makes
 * itself -- a confirmation, a cancellation, an edit -- drop the list right
 * away (`dropCachedEntryList`), so the TTL only bounds what those can't
 * reach: other data centers, whose caches are separate.
 *
 * The cache lives in the frontend rather than in the backend Worker because
 * SSR reaches the Worker through its `*.workers.dev` origin (`BACKEND_URL`),
 * where the Cache API is a no-op. Only the backend's JSON is cached, not
 * the rendered page: the page carries a per-response CSP nonce, and the
 * browser is not told to keep anything.
 */
const ENTRY_LIST_CACHE_SECONDS = 30;

/**
 * How long a list's version (see `cacheKeys`) is kept. Longer than the
 * pages it names, so it is normally only replaced by a drop; when it does
 * expire, the pages under it are merely orphaned, which costs one refetch.
 */
const VERSION_CACHE_SECONDS = 60 * 60;

/** Which public list: the two path segments of its page's URL. */
export interface EntryListRef {
  regionSlug: string;
  type: TournamentType;
}

/** One page of a public entry list, as the backend answers it. */
export type EntryListPage = Page<EntryListItem>;

/**
 * The cache keys of a list. They only have to be URLs on this host that no
 * real request uses; `origin` is the request's own, so staging and
 * production never share an entry.
 *
 * A list is paged, and the Cache API can only delete one key at a time, so
 * the pages are not keyed by the list alone: each one carries the list's
 * current version, which lives under a key of its own. Dropping the list is
 * then one delete -- of the version -- after which every page misses, and
 * the pages cached under the old version expire unread.
 */
function cacheKeys(origin: string, ref: EntryListRef) {
  const base = `${origin}/__cache/entry-list/${encodeURIComponent(ref.regionSlug)}/${ref.type}`;
  return {
    version: `${base}/version`,
    page: (version: string, offset: number) =>
      `${base}/${version}?offset=${offset}`,
  };
}

/**
 * Puts `body` in the cache for `seconds`, without holding up the response.
 * The cast only bridges the DOM and `@cloudflare/workers-types`
 * declarations of `Response` (the latter adds `Headers.getAll`); at runtime
 * this is the Workers `Response` either way.
 */
function put(
  platform: App.Platform,
  key: string,
  body: Response,
  seconds: number,
): void {
  const cache = platform.caches.default;
  body.headers.set('cache-control', `public, max-age=${seconds}`);
  platform.ctx.waitUntil(
    cache.put(key, body as unknown as Parameters<typeof cache.put>[1]),
  );
}

/**
 * Answers one page of a list from the cache, or from `fetchPage` (which
 * throws on any failure, so an error is never stored) on a miss.
 *
 * Only the offsets the pager links to -- multiples of the backend's default
 * page size -- are cached. Any other offset comes from a hand-edited URL,
 * and caching those would let anyone fill the cache with keys of their
 * choosing. `platform` is absent under `vite dev`, which never caches.
 */
export async function cachedEntryListPage(
  platform: App.Platform | undefined,
  origin: string,
  ref: EntryListRef,
  offset: number,
  fetchPage: () => Promise<EntryListPage>,
): Promise<EntryListPage> {
  if (!platform || offset % PAGE_SIZE_DEFAULT !== 0) {
    return fetchPage();
  }
  const cache = platform.caches.default;
  const keys = cacheKeys(origin, ref);

  const storedVersion = await cache.match(keys.version);
  let version: string;
  if (storedVersion) {
    version = await storedVersion.text();
    const cached = await cache.match(keys.page(version, offset));
    if (cached) {
      return (await cached.json()) as EntryListPage;
    }
  } else {
    version = crypto.randomUUID();
    put(platform, keys.version, new Response(version), VERSION_CACHE_SECONDS);
  }

  const page = await fetchPage();
  put(
    platform,
    keys.page(version, offset),
    Response.json(page),
    ENTRY_LIST_CACHE_SECONDS,
  );
  return page;
}

/**
 * Drops every cached page of a list from this data center's cache after a
 * write that changes it. Awaited, so the participant's next look at the
 * list already misses. A failure is swallowed: the write itself succeeded,
 * and the stale pages expire on their own within `ENTRY_LIST_CACHE_SECONDS`.
 */
export async function dropCachedEntryList(
  platform: App.Platform | undefined,
  origin: string,
  ref: EntryListRef,
): Promise<void> {
  try {
    await platform?.caches.default.delete(cacheKeys(origin, ref).version);
  } catch {
    // See above: the TTL bounds the staleness.
  }
}
