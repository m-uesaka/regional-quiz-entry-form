import {error, redirect} from '@sveltejs/kit';
import {TournamentTypeSchema} from '@regional-quiz/shared';
import {createApiClient, isUnauthorized} from '$lib/api';
import {staffLoginPath} from '$lib/server/staff-login';
import type {PageServerLoad} from './$types';

export const load: PageServerLoad = async ({params, fetch, locals, url}) => {
  if (!locals.staff) {
    redirect(303, staffLoginPath(url));
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
    // The claims check above cannot rule this out: the JWT may expire
    // between `hooks.server.ts` parsing it and this request reaching the
    // backend. The gate tells that apart from a caller who never had a
    // session, so a working account isn't stranded on the 403 below.
    if (isUnauthorized(tournamentRes)) {
      redirect(303, staffLoginPath(url));
    }
    // Outside the entry period the backend hands the tournament only to the
    // staff who cover it (`middleware/entry-period.ts`), so an out-of-scope
    // account is refused here rather than one request later.
    if (tournamentRes.status === 403) {
      throw error(403, 'このエントリーを閲覧する権限がありません');
    }
    throw error(502, '大会情報の取得に失敗しました');
  }
  const tournament = await tournamentRes.json();

  const res = await api.api.staff.entries[':entryId'].$get({
    param: {entryId: params.entryId},
  });
  if (!res.ok) {
    // The claims check above cannot rule this out: the JWT may expire between
    // `hooks.server.ts` parsing it and this request reaching the backend.
    if (res.status === 401) {
      redirect(303, staffLoginPath(url));
    }
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
