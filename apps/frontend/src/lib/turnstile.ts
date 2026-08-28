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
