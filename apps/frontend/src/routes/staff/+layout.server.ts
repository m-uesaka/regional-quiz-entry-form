import type {LayoutServerLoad} from './$types';

/**
 * Tells the layout whether there is a session to end. `/staff/login` sits
 * under this layout too, where there is nothing to log out of.
 */
export const load: LayoutServerLoad = ({locals}) => ({
  loggedIn: Boolean(locals.staff),
});
