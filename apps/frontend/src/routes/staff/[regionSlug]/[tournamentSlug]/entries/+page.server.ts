import {error, fail, redirect} from '@sveltejs/kit';
import {
  EntryStatusSchema,
  TournamentEntryPauseInputSchema,
  TournamentTypeSchema,
} from '@regional-quiz/shared';
import {createApiClient, isUnauthorized} from '$lib/api';
import {readPageOffset} from '$lib/pagination';
import {staffLoginPath} from '$lib/server/staff-login';
import {redirectToStaffLogin} from '$lib/server/staff-session';
import type {Actions, PageServerLoad} from './$types';

/** What the pause action hands back: the state it set, or why it refused. */
interface EntryPauseActionResult {
  paused: boolean | null;
  pauseError: string | null;
}

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

export const actions = {
  // Pauses or resumes taking entries (0039). The API checks the staff
  // member covers the tournament, so the id is taken from `load`'s read of
  // the route rather than from the form.
  pause: async ({params, request, fetch, cookies, url}) => {
    const value = (await request.formData()).get('paused');
    const input = TournamentEntryPauseInputSchema.safeParse({
      paused: value === 'true' ? true : value === 'false' ? false : undefined,
    });
    if (!input.success) {
      return pauseFailure(400, '操作内容を確認してください');
    }
    const parsedType = TournamentTypeSchema.safeParse(params.tournamentSlug);
    if (!parsedType.success) {
      return pauseFailure(404, '大会が見つかりません');
    }

    const api = createApiClient(fetch);
    const tournamentRes = await api.api.tournaments[':regionSlug'][
      ':tournamentSlug'
    ].$get({
      param: {regionSlug: params.regionSlug, tournamentSlug: parsedType.data},
    });
    if (!tournamentRes.ok) {
      if (isUnauthorized(tournamentRes)) {
        redirectToStaffLogin(cookies, url);
      }
      return pauseFailure(502, '大会情報の取得に失敗しました');
    }
    const tournament = await tournamentRes.json();

    const res = await api.api.staff.tournaments[':tournamentId'][
      'entry-pause'
    ].$put({param: {tournamentId: tournament.id}, json: input.data});
    if (!res.ok) {
      if (isUnauthorized(res)) {
        redirectToStaffLogin(cookies, url);
      }
      if (res.status === 403) {
        return pauseFailure(
          403,
          'この大会のエントリー受付を操作する権限がありません',
        );
      }
      return pauseFailure(
        502,
        input.data.paused
          ? 'エントリー受付の一時中断に失敗しました'
          : 'エントリー受付の再開に失敗しました',
      );
    }
    return {
      paused: (await res.json()).entriesPaused,
      pauseError: null,
    } satisfies EntryPauseActionResult;
  },
} satisfies Actions;

/**
 * Refuses a pause or resume, with the message to show beside its button.
 * @param status The status to answer with.
 * @param message The message.
 */
function pauseFailure(status: number, message: string) {
  return fail(status, {
    paused: null,
    pauseError: message,
  } satisfies EntryPauseActionResult);
}
