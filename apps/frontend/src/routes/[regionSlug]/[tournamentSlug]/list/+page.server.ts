import {error} from '@sveltejs/kit';
import {TournamentTypeSchema} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import {
  readCachedEntryList,
  storeEntryList,
  type EntryListRef,
} from '$lib/server/entry-list-cache';
import type {PageServerLoad} from './$types';

export const load: PageServerLoad = async ({params, fetch, platform, url}) => {
  // Same slug-narrowing rationale as the entry route's `load`: the RPC
  // client expects the literal tournament-type union, not a bare `string`.
  const parsedType = TournamentTypeSchema.safeParse(params.tournamentSlug);
  if (!parsedType.success) {
    throw error(404, '大会が見つかりません');
  }

  // Served from the Cloudflare cache when it can be (#125); see
  // `$lib/server/entry-list-cache` for why there and for how long.
  const ref: EntryListRef = {
    regionSlug: params.regionSlug,
    type: parsedType.data,
  };
  const cached = await readCachedEntryList(platform, url.origin, ref);
  if (cached) {
    return {entries: cached};
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
  storeEntryList(platform, url.origin, ref, entries);
  return {entries};
};
