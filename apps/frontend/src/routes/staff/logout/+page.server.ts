import {redirect} from '@sveltejs/kit';
import {createApiClient} from '$lib/api';
import {clearStaffSession} from '$lib/server/staff-session';
import {STAFF_LOGIN_PATH} from '$lib/server/staff-login';
import type {Actions, PageServerLoad} from './$types';

/**
 * There is no page here to look at, so a visit is sent to the login form.
 *
 * The route exists purely to give the staff layout's logout button somewhere
 * to post to: the screens carrying it are spread across the region and
 * tournament tree, a layout cannot own an action, and `/staff/login` already
 * has a `default` action, which SvelteKit does not let named actions sit
 * beside.
 */
export const load: PageServerLoad = () => {
  redirect(303, STAFF_LOGIN_PATH);
};

export const actions = {
  default: async ({cookies, fetch, url}) => {
    const api = createApiClient(fetch);
    // Caught for the same reason the participant logout catches (see
    // `routes/mypage/+page.server.ts`): an unset or malformed
    // `BACKEND_URL`, or a Worker that cannot be reached, rejects rather
    // than answering, and a logout must not leave the session standing
    // behind a 500.
    const res = await api.api.auth.staff.logout.$post().catch(() => null);
    // On success `handleFetch` has already carried the deletion `Set-Cookie`
    // into SvelteKit's cookie jar; only a call that never answered leaves
    // anything to do here.
    if (!res?.ok) {
      clearStaffSession(cookies, url);
    }
    redirect(303, STAFF_LOGIN_PATH);
  },
} satisfies Actions;
