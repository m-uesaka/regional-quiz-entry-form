import {error} from '@sveltejs/kit';
import {isWithinEntryPeriod, TournamentTypeSchema} from '@regional-quiz/shared';
import {createApiClient} from '$lib/api';
import type {PageServerLoad} from './$types';

export const load: PageServerLoad = async ({params, fetch, locals}) => {
  // The RPC client's param type for `tournamentSlug` is the literal union
  // `'saikyoi' | 'shinjinou'` (inferred from the backend's zValidator), not
  // a bare `string`, so a raw route param needs narrowing before it
  // typechecks. An invalid slug is reported as "not found", not a 500.
  const parsedType = TournamentTypeSchema.safeParse(params.tournamentSlug);
  if (!parsedType.success) {
    throw error(404, '大会が見つかりません');
  }

  const api = createApiClient(fetch);
  const res = await api.api.tournaments[':regionSlug'][':tournamentSlug'].$get({
    param: {regionSlug: params.regionSlug, tournamentSlug: parsedType.data},
  });
  if (!res.ok) {
    throw error(404, '大会が見つかりません');
  }
  const tournament = await res.json();

  if (
    !isWithinEntryPeriod(tournament.entryOpensAt, tournament.entryClosesAt) &&
    !locals.staff
  ) {
    throw error(403, 'エントリー期間外です');
  }

  return {tournament};
};
