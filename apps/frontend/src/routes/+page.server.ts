import {createApiClient} from '$lib/api';
import {groupPortalTournaments} from '$lib/portal';
import type {PageServerLoad} from './$types';

export const load: PageServerLoad = async ({fetch}) => {
  // The same list the portal shows, read here for the links to each
  // tournament's published entry list. The rest of the top page doesn't
  // depend on it, so a failed read leaves the links out (`regions: null`)
  // rather than turning the whole page into an error.
  try {
    const api = createApiClient(fetch);
    const res = await api.api.portal.tournaments.$get();
    if (!res.ok) {
      return {regions: null};
    }
    return {regions: groupPortalTournaments(await res.json(), new Date())};
  } catch {
    return {regions: null};
  }
};
