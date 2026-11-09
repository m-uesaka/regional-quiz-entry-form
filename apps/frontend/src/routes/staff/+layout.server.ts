import {
  pendingInvitesData,
  takePendingInvites,
} from '$lib/server/staff-pending-invites';
import type {LayoutServerLoad} from './$types';

/**
 * Tells the layout whether there is a session to end, and whether to link
 * to the dashboard. `/staff/login` sits under this layout too, where there
 * is nothing to log out of. The dashboard is for general staff only
 * (`dashboard/+page.server.ts` answers 403 to anyone else), so regional staff
 * are not shown a link that would only lead there.
 *
 * It also shows, once, the warning the login left for the page it landed
 * on: which of the address's other accounts still wait on their invite link.
 */
export const load: LayoutServerLoad = ({locals, cookies}) => ({
  loggedIn: Boolean(locals.staff),
  isGeneralStaff: locals.staff?.role === 'general',
  ...(locals.staff ? pendingInvitesData(takePendingInvites(cookies)) : {}),
});
