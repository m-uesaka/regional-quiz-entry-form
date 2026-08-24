import type {Handle} from '@sveltejs/kit';
import {readStaffClaims} from '$lib/server/staff-session';

// Matches `STAFF_SESSION_COOKIE` in
// `apps/backend/src/middleware/staff-auth.ts`.
const STAFF_SESSION_COOKIE = 'staff_session';

export const handle: Handle = async ({event, resolve}) => {
  event.locals.staff = await readStaffClaims(
    event.cookies.get(STAFF_SESSION_COOKIE),
    event.platform?.env?.SESSION_SECRET,
  );
  return resolve(event);
};
