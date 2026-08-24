import {error} from '@sveltejs/kit';
import {TournamentTypeSchema} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import type {PageServerLoad} from './$types';

export const load: PageServerLoad = async ({params, fetch, locals}) => {
  if (!locals.staff) {
    throw error(401, 'ログインが必要です');
  }

  // Same slug-narrowing rationale as the list route's `load`: the RPC
  // client expects the literal tournament-type union, not a bare `string`.
  const parsedType = TournamentTypeSchema.safeParse(params.tournamentSlug);
  if (!parsedType.success) {
    throw error(404, '大会が見つかりません');
  }

  const api = createApiClient(fetch);

  // The entry detail endpoint is keyed only by entry UUID, so the tournament
  // implied by the URL must be resolved and cross-checked against the
  // entry's own `tournamentId` to avoid displaying an entry from another
  // tournament under this URL (and thus linking "back" to the wrong list).
  const tournamentRes = await api.api.tournaments[':regionSlug'][
    ':tournamentSlug'
  ].$get({
    param: {regionSlug: params.regionSlug, tournamentSlug: parsedType.data},
  });
  if (!tournamentRes.ok) {
    if (tournamentRes.status === 404) {
      throw error(404, '大会が見つかりません');
    }
    throw error(502, '大会情報の取得に失敗しました');
  }
  const tournament = await tournamentRes.json();

  const res = await api.api.staff.entries[':entryId'].$get({
    param: {entryId: params.entryId},
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw error(404, 'エントリーが見つかりません');
    }
    if (res.status === 403) {
      throw error(403, 'このエントリーを閲覧する権限がありません');
    }
    throw error(502, 'エントリー情報の取得に失敗しました');
  }

  const entry = await res.json();
  if (entry.tournamentId !== tournament.id) {
    throw error(404, 'エントリーが見つかりません');
  }

  return {entry};
};
