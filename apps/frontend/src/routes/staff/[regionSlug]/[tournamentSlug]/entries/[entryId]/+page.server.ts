import {error, redirect} from '@sveltejs/kit';
import {createApiClient} from '$lib/api';
import {staffLoginPath} from '$lib/server/staff-login';
import {redirectToStaffLogin} from '$lib/server/staff-session';
import {fetchTournamentBySlug} from '$lib/server/tournament-by-slug';
import type {PageServerLoad} from './$types';

export const load: PageServerLoad = async ({
  params,
  fetch,
  locals,
  cookies,
  url,
}) => {
  if (!locals.staff) {
    redirect(303, staffLoginPath(url));
  }

  // The entry detail endpoint is keyed only by entry UUID, so the tournament
  // implied by the URL must be resolved and cross-checked against the
  // entry's own `tournamentId` to avoid displaying an entry from another
  // tournament under this URL (and thus linking "back" to the wrong list).
  const tournament = await fetchTournamentBySlug(
    {params, fetch, cookies, url},
    {forbiddenMessages: {fallback: 'このエントリーを閲覧する権限がありません'}},
  );

  const api = createApiClient(fetch);

  const res = await api.api.staff.entries[':entryId'].$get({
    param: {entryId: params.entryId},
  });
  if (!res.ok) {
    // The claims check above cannot rule this out: the JWT may expire between
    // `hooks.server.ts` parsing it and this request reaching the backend.
    if (res.status === 401) {
      redirectToStaffLogin(cookies, url);
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
