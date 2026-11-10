import {error} from '@sveltejs/kit';
import {form, getRequestEvent} from '$app/server';
import {RegionCreateInputSchema} from '@regional-quiz/shared';
import {remoteFormPageUrl} from '$lib/remote-form';
import {redirectToStaffLogin} from '$lib/server/staff-session';
import {
  RegionRowSchema,
  submitNewRegion,
  submitRegionRow,
  type StaffRequest,
} from './region-forms.server';

// The two forms of this screen, as SvelteKit remote functions (#376). Each
// one's schema is checked before its handler runs, and what the schema
// refuses goes back to the controls without the handler being called.

/**
 * Refuses a caller who is not a general staff member.
 *
 * A remote function is an endpoint of its own, so `admin/+layout.server.ts`
 * does not stand in front of it the way it does in front of the page's
 * `load`. The API checks the session again either way; this only saves the
 * round trip and words the refusal the way the layout does.
 */
function requireGeneralStaff(): StaffRequest {
  const {fetch, cookies, locals, url: requestUrl} = getRequestEvent();
  const url = remoteFormPageUrl(requestUrl);
  if (!locals.staff) {
    redirectToStaffLogin(cookies, url);
  }
  if (locals.staff.role !== 'general') {
    error(403, 'この画面を利用する権限がありません');
  }
  return {fetch, cookies, url};
}

/** Creates a region from the form at the top of the screen. */
export const createRegion = form(RegionCreateInputSchema, (input, issue) =>
  submitNewRegion(requireGeneralStaff(), input, issue),
);

/**
 * Updates one region. Each row takes an instance of its own with
 * `updateRegion.for(region.id)`.
 */
export const updateRegion = form(RegionRowSchema, input =>
  submitRegionRow(requireGeneralStaff(), input),
);
