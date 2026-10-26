import {PARTICIPANT_LOGIN_PATH} from './participant-session';

/** Where a participant lands after logging in, when nothing says otherwise. */
export const PARTICIPANT_HOME_PATH = '/mypage';

// An entry form, `/<regionSlug>/<tournamentType>/entry`. Region slugs are
// lower-case letters, digits and hyphens (`RegionSlugSchema`); spelled out
// here rather than imported so the pattern can't widen to something that
// lets `//evil.example` through.
const ENTRY_FORM_PATH = /^\/[a-z0-9-]+\/(saikyoi|shinjinou)\/entry$/;

/**
 * The login screen, set to hand the participant back to `target` once they
 * have logged in. Used by the entry form, which a registered participant has
 * to submit logged in (#117).
 * @param target The entry form to come back to.
 */
export function participantLoginPath(target: string): string {
  return `${PARTICIPANT_LOGIN_PATH}?redirectTo=${encodeURIComponent(target)}`;
}

/**
 * Narrows a `redirectTo` value to a page the login screen will send a
 * browser to: an entry form, which is the only page that sends participants
 * here with one. Anything else -- including a protocol-relative `//host`
 * that would leave the site -- falls back to the mypage.
 * @param target The raw `redirectTo` value.
 */
export function participantLandingPath(target: string | null): string {
  return target && ENTRY_FORM_PATH.test(target)
    ? target
    : PARTICIPANT_HOME_PATH;
}
