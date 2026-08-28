/**
 * The name Turnstile gives the hidden control it writes its token into, and
 * the header the API expects that token in.
 *
 * One constant for both because they are deliberately the same string: the
 * page actions read the control out of the submitted form and put it
 * straight onto the API call. Matches `TURNSTILE_TOKEN_HEADER` in
 * `apps/backend/src/middleware/turnstile.ts`.
 */
export const TURNSTILE_TOKEN_FIELD = 'cf-turnstile-response';

/**
 * What a Turnstile token may contain, as far as this page is concerned.
 *
 * Visible ASCII only. Cloudflare documents the token as an opaque string of
 * up to 2048 characters and its shape can change, so this deliberately does
 * not try to describe the format -- it only excludes what cannot travel in
 * an HTTP header at all (CR, LF, NUL, other control bytes, and anything
 * non-ASCII), with room to spare on the length.
 */
const TURNSTILE_TOKEN_PATTERN = /^[\x21-\x7e]{1,4096}$/;

/**
 * The token a submitted form carries, or the empty string if it carries
 * nothing that could be one.
 *
 * A page action can be posted to directly, so this control holds whatever
 * the caller put in it -- and its value is forwarded as an HTTP header.
 * `new Request()` throws a `TypeError` on a header value it cannot
 * represent, which inside an action is an unhandled 500 error page rather
 * than the 400 the challenge is meant to answer with. Dropping anything
 * unusable to the empty string routes it back to that 400: the API fails
 * closed on a missing token exactly as it does on an invalid one.
 *
 * @param formData The submitted form.
 */
export function readTurnstileToken(formData: FormData): string {
  const value = formData.get(TURNSTILE_TOKEN_FIELD);
  if (typeof value !== 'string' || !TURNSTILE_TOKEN_PATTERN.test(value)) {
    return '';
  }
  return value;
}
