import type {LayoutServerLoad} from './$types';

/**
 * Tells the layout whether there is a session to end.
 *
 * `/mypage/login` sits under this layout too, and offering a logout button
 * to someone who is not logged in would only produce a redirect back to the
 * form they are already looking at. `locals.participant` is the same claim
 * set `hooks.server.ts` verified the session cookie into, so this agrees
 * with what the API would say about the cookie.
 */
export const load: LayoutServerLoad = ({locals}) => ({
  loggedIn: Boolean(locals.participant),
});
