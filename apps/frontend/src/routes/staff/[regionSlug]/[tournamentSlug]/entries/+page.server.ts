import {error, redirect} from '@sveltejs/kit';
import {EntryStatusSchema, TournamentTypeSchema} from '@regional-quiz/shared';
import {createApiClient, isUnauthorized} from '$lib/api';
import {readPageOffset} from '$lib/pagination';
import {staffLoginPath} from '$lib/server/staff-login';
import {redirectToStaffLogin} from '$lib/server/staff-session';
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
    // The claims check above cannot rule this out: the JWT may expire
    // between `hooks.server.ts` parsing it and this request reaching the
    // backend. The gate tells that apart from a caller who never had a
    // session, so a working account isn't stranded on the 403 below.
    if (isUnauthorized(tournamentRes)) {
      redirectToStaffLogin(cookies, url);
    }
    // Outside the entry period the backend hands the tournament only to the
    // staff who cover it (`middleware/entry-period.ts`), so an out-of-scope
    // account is refused here rather than one request later.
    if (tournamentRes.status === 403) {
      throw error(403, 'この大会のエントリーを閲覧する権限がありません');
    }
    throw error(502, '大会情報の取得に失敗しました');
  }
  const tournament = await tournamentRes.json();

  // An unknown `?status=` (a hand-edited URL) lists every status rather
  // than letting the backend's 400 fail the page.
  const parsedStatus = EntryStatusSchema.safeParse(
    url.searchParams.get('status'),
  );
  const status = parsedStatus.success ? parsedStatus.data : null;
  const entriesRes = await api.api.staff.tournaments[
    ':tournamentId'
  ].entries.$get({
    param: {tournamentId: tournament.id},
    query: {
      offset: readPageOffset(url.searchParams),
      ...(status ? {status} : {}),
    },
  });
  if (!entriesRes.ok) {
    // The claims check above cannot rule this out: the JWT may expire between
    // `hooks.server.ts` parsing it and this request reaching the backend.
    if (entriesRes.status === 401) {
      redirectToStaffLogin(cookies, url);
    }
    if (entriesRes.status === 403) {
      throw error(403, 'この大会のエントリーを閲覧する権限がありません');
    }
    throw error(502, 'エントリー情報の取得に失敗しました');
  }

  const {items, ...paging} = await entriesRes.json();
  return {tournament, entries: items, ...paging, status};
};
