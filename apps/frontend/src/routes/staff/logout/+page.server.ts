import {redirect} from '@sveltejs/kit';
import {createApiClient} from '$lib/api';
import {forwardSetCookies} from '$lib/server/backend-cookies';
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
    const res = await api.api.auth.staff.logout.$post();
    // The API answers with the cookie deletion, and `/api/*` goes to the
    // backend Worker's own origin, so the `Set-Cookie` is re-issued from
    // this origin by hand to reach the browser at all.
    forwardSetCookies(res, cookies, url);
    // The endpoint only writes a header, so it cannot fail on its own
    // terms, but the request to it can (the Worker being down, say). A
    // logout that quietly leaves the session in place is the one outcome
    // not worth reporting back, so the cookie is dropped here as well.
    if (!res.ok) {
      clearStaffSession(cookies);
    }
    redirect(303, STAFF_LOGIN_PATH);
  },
} satisfies Actions;
