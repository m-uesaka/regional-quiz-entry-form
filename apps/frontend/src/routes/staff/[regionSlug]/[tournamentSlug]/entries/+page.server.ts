import {error} from '@sveltejs/kit';
import {TournamentTypeSchema} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import type {PageServerLoad} from './$types';

export const load: PageServerLoad = async ({params, fetch, locals}) => {
  if (!locals.staff) {
    throw error(401, 'ログインが必要です');
  }

  // Same slug-narrowing rationale as the public list route's `load`: the RPC
  // client expects the literal tournament-type union, not a bare `string`.
  const parsedType = TournamentTypeSchema.safeParse(params.tournamentSlug);
  if (!parsedType.success) {
    throw error(404, '大会が見つかりません');
  }

  const api = createApiClient(fetch);

  // The staff entries endpoint is keyed by the tournament's UUID, not its
  // slug, so the tournament must be resolved first.
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

  const entriesRes = await api.api.staff.tournaments[
    ':tournamentId'
  ].entries.$get({
    param: {tournamentId: tournament.id},
  });
  if (!entriesRes.ok) {
    if (entriesRes.status === 403) {
      throw error(403, 'この大会のエントリーを閲覧する権限がありません');
    }
    throw error(502, 'エントリー情報の取得に失敗しました');
  }

  return {tournament, entries: await entriesRes.json()};
};
