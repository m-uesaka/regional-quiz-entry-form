import {error} from '@sveltejs/kit';
import {TournamentTypeSchema} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import {readPageOffset} from '$lib/pagination';
import {cachedEntryListPage} from '$lib/server/entry-list-cache';
import type {PageServerLoad} from './$types';

export const load: PageServerLoad = async ({params, fetch, platform, url}) => {
  // Same slug-narrowing rationale as the entry route's `load`: the RPC
  // client expects the literal tournament-type union, not a bare `string`.
  const parsedType = TournamentTypeSchema.safeParse(params.tournamentSlug);
  if (!parsedType.success) {
    throw error(404, '大会が見つかりません');
  }
  const offset = readPageOffset(url.searchParams);

  // Served from the Cloudflare cache when it can be (#125); see
  // `$lib/server/entry-list-cache` for why there, for how long, and for
  // which pages.
  const {items, ...paging} = await cachedEntryListPage(
    platform,
    url.origin,
    {regionSlug: params.regionSlug, type: parsedType.data},
    offset,
    async () => {
      const api = createApiClient(fetch);

      // The slug-keyed entry list, not `GET /tournaments/:regionSlug/:tournamentSlug`
      // followed by the UUID-keyed one. The tournament read is gated on the
      // entry period now (`middleware/entry-period.ts`), and this page has to
      // keep working after entries close -- which is when it is read most.
      const res = await api.api.tournaments[':regionSlug'][':tournamentSlug'][
        'entry-list'
      ].$get({
        param: {
          regionSlug: params.regionSlug,
          tournamentSlug: parsedType.data,
        },
        // One page at a time, so the SSR'd HTML stays the same size however
        // many have entered. The backend's default page size applies.
        query: {offset},
      });
      if (!res.ok) {
        // Thrown, so an error never reaches the cache: a tournament created
        // a moment later, or a backend that has just recovered, must show
        // up on the next request.
        if (res.status === 404) {
          throw error(404, '大会が見つかりません');
        }
        throw error(502, 'エントリーリストの取得に失敗しました');
      }
      return res.json();
    },
  );
  return {entries: items, ...paging};
};
