import {fetchPendingInvitesData} from '$lib/server/staff-pending-invites';
import type {LayoutServerLoad} from './$types';

/**
 * Tells the layout whether there is a session to end, and whether to link
 * to the dashboard. `/staff/login` sits under this layout too, where there
 * is nothing to log out of. The dashboard is for general staff only
 * (`dashboard/+page.server.ts` answers 403 to anyone else), so regional staff
 * are not shown a link that would only lead there.
 *
 * It also warns, for as long as it lasts, that some of the address's other
 * accounts still wait on their invite link -- asked only with a session,
 * since there is no address to ask about without one.
 */
export const load: LayoutServerLoad = async ({locals, fetch}) => ({
  loggedIn: Boolean(locals.staff),
  isGeneralStaff: locals.staff?.role === 'general',
  ...(locals.staff ? await fetchPendingInvitesData(fetch) : {}),
});
