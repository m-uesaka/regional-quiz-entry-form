import {loadPortalRegions} from '$lib/server/portal-regions';
import type {PageServerLoad} from './$types';

export const load: PageServerLoad = async ({fetch}) => ({
  regions: await loadPortalRegions(fetch),
});
