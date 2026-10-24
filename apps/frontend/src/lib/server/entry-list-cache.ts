import type {EntryListItem, TournamentType} from '@regional-quiz/shared';

/**
 * How long a fetched public entry list is served from the Cloudflare cache
 * (#125).
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

/** Which public list: the two path segments of its page's URL. */
export interface EntryListRef {
  regionSlug: string;
  type: TournamentType;
}

/**
 * The cache key for a list. It only has to be a URL on this host that no
 * real request uses; `origin` is the request's own, so staging and
 * production never share an entry.
 */
function cacheKey(origin: string, ref: EntryListRef): string {
  return `${origin}/__cache/entry-list/${encodeURIComponent(ref.regionSlug)}/${ref.type}`;
}

/**
 * The cached list, or `null` on a miss. `platform` is absent under
 * `vite dev`, which therefore always misses.
 */
export async function readCachedEntryList(
  platform: App.Platform | undefined,
  origin: string,
  ref: EntryListRef,
): Promise<EntryListItem[] | null> {
  const cached = await platform?.caches.default.match(cacheKey(origin, ref));
  return cached ? ((await cached.json()) as EntryListItem[]) : null;
}

/** Stores a freshly fetched list, without holding up the response. */
export function storeEntryList(
  platform: App.Platform | undefined,
  origin: string,
  ref: EntryListRef,
  entries: EntryListItem[],
): void {
  if (!platform) {
    return;
  }
  const copy = Response.json(entries, {
    headers: {'cache-control': `public, max-age=${ENTRY_LIST_CACHE_SECONDS}`},
  });
  const cache = platform.caches.default;
  // The cast only bridges the DOM and `@cloudflare/workers-types`
  // declarations of `Response` (the latter adds `Headers.getAll`); at
  // runtime this is the Workers `Response` either way.
  platform.ctx.waitUntil(
    cache.put(
      cacheKey(origin, ref),
      copy as unknown as Parameters<typeof cache.put>[1],
    ),
  );
}

/**
 * Drops a list from this data center's cache after a write that changes it.
 * Awaited, so the participant's next look at the list already misses. A
 * failure is swallowed: the write itself succeeded, and the stale copy
 * expires on its own within `ENTRY_LIST_CACHE_SECONDS`.
 */
export async function dropCachedEntryList(
  platform: App.Platform | undefined,
  origin: string,
  ref: EntryListRef,
): Promise<void> {
  try {
    await platform?.caches.default.delete(cacheKey(origin, ref));
  } catch {
    // See above: the TTL bounds the staleness.
  }
}
