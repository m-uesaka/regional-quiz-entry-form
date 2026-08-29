import {error, redirect} from '@sveltejs/kit';
import {createApiClient, isUnauthorized} from '$lib/api';
import {staffLoginPath} from '$lib/server/staff-login';
import type {PageServerLoad} from './$types';

// Read server-side rather than from the browser: `/api/*` is only routed to
// the backend Worker for requests the frontend makes itself until Task 9-5
// lands, so a client-side read of the regions would 404 in production.
export const load: PageServerLoad = async ({fetch, url}) => {
  const res = await createApiClient(fetch).api.regions.$get();
  if (!res.ok) {
    if (isUnauthorized(res)) {
      redirect(303, staffLoginPath(url));
    }
    error(502, '地域の取得に失敗しました');
  }
  return {regions: await res.json()};
};
