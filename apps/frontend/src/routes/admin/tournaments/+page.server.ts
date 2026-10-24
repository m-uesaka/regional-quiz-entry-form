import {error} from '@sveltejs/kit';
import {createApiClient, isUnauthorized} from '$lib/api';
import {redirectToStaffLogin} from '$lib/server/staff-session';
import type {PageServerLoad} from './$types';

// The way into a tournament's edit screen: until this list existed, the
// only link to it was the redirect right after creating the tournament, so
// a mistake noticed later had no screen to fix it from (#164).
export const load: PageServerLoad = async ({fetch, cookies, url}) => {
  const api = createApiClient(fetch);
  const [tournamentsRes, regionsRes] = await Promise.all([
    api.api.tournaments.$get(),
    api.api.regions.$get(),
  ]);
  if (isUnauthorized(tournamentsRes) || isUnauthorized(regionsRes)) {
    redirectToStaffLogin(cookies, url);
  }
  if (!tournamentsRes.ok || !regionsRes.ok) {
    error(502, '大会一覧の取得に失敗しました');
  }

  const regions = await regionsRes.json();
  const regionNames = new Map(regions.map(region => [region.id, region.name]));
  const tournaments = (await tournamentsRes.json())
    .map(tournament => ({
      ...tournament,
      regionName: regionNames.get(tournament.regionId) ?? '',
    }))
    // Region, then 最強位 before 新人王 -- the order the dashboard uses.
    .sort(
      (a, b) =>
        a.regionName.localeCompare(b.regionName, 'ja') ||
        a.type.localeCompare(b.type),
    );

  return {
    tournaments,
    // Set by the edit screen's delete action, which lands here.
    deleted: url.searchParams.has('deleted'),
  };
};
