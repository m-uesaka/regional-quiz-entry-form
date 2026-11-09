import {error, redirect} from '@sveltejs/kit';
import {staffLoginPath} from '$lib/server/staff-login';
import {fetchPendingInvitesData} from '$lib/server/staff-pending-invites';
import type {LayoutServerLoad} from './$types';

// `/admin` is general-staff only. The APIs behind these screens all run
// `requireGeneralStaff()` themselves, but without this an anonymous visitor
// was handed a working-looking management form and only told about the
// missing session once they submitted it (`admin/tournaments/new` had no
// server load at all). This is the same entry-side guard `/staff/*` already
// applies, hoisted to the layout so every screen under `/admin` inherits it.
export const load: LayoutServerLoad = async ({locals, url, fetch}) => {
  if (!locals.staff) {
    redirect(303, staffLoginPath(url));
  }
  // Regional staff have a session, so sending them back to the login form
  // would just loop; they are told they are in the wrong place instead.
  if (locals.staff.role !== 'general') {
    error(403, 'この画面を利用する権限がありません');
  }
  // The warning about the address's accounts still waiting on their invite
  // is shown on the management screens too: general staff land here as
  // often as under `/staff`.
  return {
    staff: locals.staff,
    ...(await fetchPendingInvitesData(fetch)),
  };
};
