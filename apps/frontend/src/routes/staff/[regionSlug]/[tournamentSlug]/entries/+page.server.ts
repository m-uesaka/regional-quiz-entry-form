import {error, fail, redirect} from '@sveltejs/kit';
import {
  EntryStatusSchema,
  TournamentEntryPauseInputSchema,
  TournamentSchema,
} from '@regional-quiz/shared';
import {createApiClient, isUnauthorized} from '$lib/api';
import {readPageOffset} from '$lib/pagination';
import {staffLoginPath} from '$lib/server/staff-login';
import {redirectToStaffLogin} from '$lib/server/staff-session';
import {fetchTournamentBySlug} from '$lib/server/tournament-by-slug';
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

  // The staff entries endpoint is keyed by the tournament's UUID, not its
  // slug, so the tournament must be resolved first.
  const tournament = await fetchTournamentBySlug(
    {params, fetch, cookies, url},
    {forbiddenMessage: 'この大会のエントリーを閲覧する権限がありません'},
  );

  const api = createApiClient(fetch);

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
  // Pauses or resumes taking entries (0039). The tournament comes as the
  // id `load` rendered into the form rather than from reading the route's
  // slugs again: the API checks the staff member covers whichever
  // tournament it names, so the id needs no vouching for here.
  pause: async ({request, fetch, cookies, url}) => {
    const formData = await request.formData();
    const tournamentId = TournamentSchema.shape.id.safeParse(
      formData.get('tournamentId'),
    );
    const value = formData.get('paused');
    const input = TournamentEntryPauseInputSchema.safeParse({
      paused: value === 'true' ? true : value === 'false' ? false : undefined,
    });
    if (!tournamentId.success || !input.success) {
      return pauseFailure(400, '操作内容を確認してください');
    }

    const res = await createApiClient(fetch).api.staff.tournaments[
      ':tournamentId'
    ]['entry-pause'].$put({
      param: {tournamentId: tournamentId.data},
      json: input.data,
    });
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
      if (res.status === 404) {
        return pauseFailure(404, '大会が見つかりません');
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
