// The one-time token the password reset mails put in the link they send
// (`/password-reset?token=...`, `/staff/password-reset?token=...`).
//
// The token has to be read from the URL, because that is the only place a
// mailed link can carry it. But a URL is also what ends up in the browser's
// history, in a `Referer`, and on a screen someone else can read, so the page
// takes it out again as soon as it has rendered (#120). From then on the
// form carries the token in a hidden field, which is what the action reads
// first.

/** The query parameter and the form field the token travels in. */
export const TOKEN_PARAM = 'token';

/**
 * Reads the token out of a page's URL.
 *
 * A present but empty `?token=` counts as absent, so that a page's `load`
 * and its form action agree on which state a request belongs to: an empty
 * token would otherwise render the new-password form and then be refused by
 * the schema as if the password were at fault.
 *
 * @param url The URL the page was requested with.
 * @return The token, or `null` when there isn't a usable one.
 */
export function readUrlToken(url: URL): string | null {
  return url.searchParams.get(TOKEN_PARAM) || null;
}

/**
 * Reads the token a form submission belongs to.
 *
 * The hidden field comes first: once the page has taken the token out of
 * the address bar, the form posts to the bare URL and the field is the only
 * place left that has it. The URL is the fallback for a submission whose
 * page never ran its script, which still has the token in the address it
 * posts back to.
 *
 * @param formData The submitted form.
 * @param url The URL the form was posted to.
 * @return The token, or `null` when neither place has a usable one.
 */
export function readSubmittedToken(
  formData: FormData,
  url: URL,
): string | null {
  const field = formData.get(TOKEN_PARAM);
  if (typeof field === 'string' && field !== '') return field;
  return readUrlToken(url);
}

/**
 * Takes the token out of the address bar, leaving the rest of the URL and
 * the history entry as they were.
 *
 * `history.replaceState()` rather than `replaceState` from
 * `$app/navigation`: SvelteKit's refuses to run until its router has
 * started, which on a page's first load is after the page's `onMount` --
 * the moment this has to run. The history entry's `state` is handed back
 * unchanged, because SvelteKit keeps its own bookkeeping for Back/Forward
 * in it. Under `vite dev` SvelteKit logs a warning about the direct call
 * once per page load; it is expected, and production builds do not have it.
 */
export function removeTokenFromLocation(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(TOKEN_PARAM)) return;
  url.searchParams.delete(TOKEN_PARAM);
  history.replaceState(history.state, '', url);
}
