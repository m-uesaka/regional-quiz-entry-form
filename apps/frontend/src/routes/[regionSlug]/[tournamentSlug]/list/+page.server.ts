import {error} from '@sveltejs/kit';
import {TournamentTypeSchema, type EntryListItem} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import type {PageServerLoad} from './$types';

/**
 * How long a fetched entry list is served from the Cloudflare cache (#125).
 *
 * The list is read most right before the deadline, and everyone reads the
 * same thing, so up to this many seconds of staleness buys back the
 * Worker → Supabase round-trips for every render in between.
 *
 * The cache lives here rather than in the backend Worker because the SSR
 * call reaches the Worker through its `*.workers.dev` origin (`BACKEND_URL`),
 * where the Cache API is a no-op. Only the backend's JSON is cached, not
 * the rendered page: the page carries a per-response CSP nonce, and the
 * browser is not told to keep anything.
 */
const ENTRY_LIST_CACHE_SECONDS = 30;

export const load: PageServerLoad = async ({params, fetch, platform, url}) => {
  // Same slug-narrowing rationale as the entry route's `load`: the RPC
  // client expects the literal tournament-type union, not a bare `string`.
  const parsedType = TournamentTypeSchema.safeParse(params.tournamentSlug);
  if (!parsedType.success) {
    throw error(404, '大会が見つかりません');
  }

  // `platform` is absent under `vite dev`; the list is then simply fetched
  // every time. The key only has to be a URL on this host that no real
  // request uses.
  const cache = platform?.caches.default;
  const cacheKey = `${url.origin}/__cache/entry-list/${encodeURIComponent(params.regionSlug)}/${parsedType.data}`;
  const cached = await cache?.match(cacheKey);
  if (cached) {
    return {entries: (await cached.json()) as EntryListItem[]};
  }

  const api = createApiClient(fetch);

  // The slug-keyed entry list, not `GET /tournaments/:regionSlug/:tournamentSlug`
  // followed by the UUID-keyed one. The tournament read is gated on the
  // entry period now (`middleware/entry-period.ts`), and this page has to
  // keep working after entries close -- which is when it is read most.
  const res = await api.api.tournaments[':regionSlug'][':tournamentSlug'][
    'entry-list'
  ].$get({
    param: {regionSlug: params.regionSlug, tournamentSlug: parsedType.data},
  });
  if (!res.ok) {
    // Errors are never cached: a tournament created a moment later, or a
    // backend that has just recovered, must show up on the next request.
    if (res.status === 404) {
      throw error(404, '大会が見つかりません');
    }
    throw error(502, 'エントリーリストの取得に失敗しました');
  }

  const entries = await res.json();
  if (cache) {
    const copy = Response.json(entries, {
      headers: {'cache-control': `public, max-age=${ENTRY_LIST_CACHE_SECONDS}`},
    });
    // The cast only bridges the DOM and `@cloudflare/workers-types`
    // declarations of `Response` (the latter adds `Headers.getAll`); at
    // runtime this is the Workers `Response` either way.
    platform.ctx.waitUntil(
      cache.put(cacheKey, copy as unknown as Parameters<typeof cache.put>[1]),
    );
  }
  return {entries};
};
