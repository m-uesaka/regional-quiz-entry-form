import {error} from '@sveltejs/kit';
import {createApiClient, isUnauthorized} from '$lib/api';
import {redirectToStaffLogin} from '$lib/server/staff-session';
import type {PageServerLoad} from './$types';

// The two forms on this screen are remote functions (`regions.remote.ts`),
// not actions: this file only reads the list they change.

export const load: PageServerLoad = async ({fetch, cookies, url}) => {
  const res = await createApiClient(fetch).api.regions.$get();
  if (!res.ok) {
    // The layout guard cannot rule this out: the JWT may expire between
    // `hooks.server.ts` parsing it and this request reaching the backend.
    if (isUnauthorized(res)) {
      redirectToStaffLogin(cookies, url);
    }
    error(502, '地域の取得に失敗しました');
  }
  return {regions: await res.json()};
};
