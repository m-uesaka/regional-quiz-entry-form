import type {Handle} from '@sveltejs/kit';
import {readStaffClaims} from '$lib/server/staff-session';
import {readParticipantClaims} from '$lib/server/participant-session';

// Matches `STAFF_SESSION_COOKIE` in
// `apps/backend/src/middleware/staff-auth.ts`.
const STAFF_SESSION_COOKIE = 'staff_session';
// Matches `PARTICIPANT_SESSION_COOKIE` in
// `apps/backend/src/middleware/participant-auth.ts`.
const PARTICIPANT_SESSION_COOKIE = 'participant_session';

export const handle: Handle = async ({event, resolve}) => {
  event.locals.staff = await readStaffClaims(
    event.cookies.get(STAFF_SESSION_COOKIE),
    event.platform?.env?.SESSION_SECRET,
  );
  event.locals.participant = await readParticipantClaims(
    event.cookies.get(PARTICIPANT_SESSION_COOKIE),
    event.platform?.env?.SESSION_SECRET,
  );
  return resolve(event);
};
