// The response headers `handle` in `src/hooks.server.ts` puts on every page
// (#120). The Content-Security-Policy is not here: SvelteKit builds that one
// itself from `csp` in `vite.config.ts`, because only it knows the nonce of
// the inline scripts it renders into each page.

/**
 * Pages that show a participant's or a staff member's personal data. Their
 * responses are kept out of shared caches and the back/forward cache, so a
 * page left behind on a shared computer is not one Back press away. The
 * public entry list is deliberately not among them.
 */
const PRIVATE_PATH_PREFIXES: readonly string[] = [
  '/mypage',
  '/staff',
  '/admin',
];

/**
 * Pages a mailed link opens with a one-time token in the query string
 * (`?token=...`): the entry confirmation and the two password reset screens.
 * Each answers that request with a redirect to a URL without the token
 * (`/verify` after consuming it, the reset screens after moving it into a
 * cookie: `$lib/server/reset-token.ts`), so these headers are on that
 * redirect.
 * `/staff/password-reset` is also covered by `/staff` above, but is listed
 * here for the referrer policy, which `/staff` alone does not get.
 */
const TOKEN_PATH_PREFIXES: readonly string[] = [
  '/verify',
  '/password-reset',
  '/staff/password-reset',
];

/**
 * The referrer policy of every page but the token-bearing ones: the browser
 * default, stated so that it does not depend on the browser. Cross-origin
 * requests see the origin only, never the path or the query.
 *
 * Not `no-referrer` everywhere, for two reasons. A browser sends a form
 * submission's `Origin` as `null` under `no-referrer`, and SvelteKit's own
 * CSRF check refuses that -- every form that works without JavaScript (#95)
 * would answer 403 before hydration. And Cloudflare Turnstile, which the
 * entry form embeds, is a cross-origin frame that is entitled to know which
 * site it was embedded in.
 */
const DEFAULT_REFERRER_POLICY = 'strict-origin-when-cross-origin';

/**
 * The referrer policy of a page whose URL carries a token: no `Referer` at
 * all leaves for another site, so following a link from the page cannot
 * hand the token over. `same-origin` rather than `no-referrer` because the
 * reset screens are themselves forms, and under `no-referrer` their
 * submission would arrive with `Origin: null` (see above).
 */
const TOKEN_PAGE_REFERRER_POLICY = 'same-origin';

/**
 * Puts the security headers on a page response.
 *
 * @param headers The response's headers, changed in place.
 * @param url The URL the page was requested with.
 * @param method The request's method.
 */
export function applySecurityHeaders(
  headers: Headers,
  url: URL,
  method: string,
): void {
  const {pathname} = url;
  headers.set('x-content-type-options', 'nosniff');

  const carriesToken =
    matchesAnyPrefix(pathname, TOKEN_PATH_PREFIXES) &&
    url.searchParams.has('token');
  headers.set(
    'referrer-policy',
    carriesToken ? TOKEN_PAGE_REFERRER_POLICY : DEFAULT_REFERRER_POLICY,
  );

  // A token page is no-store as well: the token is spent once used, and a
  // copy of the page in a cache would be the one place it outlived that.
  //
  // So is the answer to any form submission, on whichever page: it is
  // rendered from what was just typed in, which on the public entry form is
  // the participant's name and address -- echoed back by a refusal, or
  // confirmed by the success screen. Only a page's GET is left cacheable.
  if (
    matchesAnyPrefix(pathname, PRIVATE_PATH_PREFIXES) ||
    carriesToken ||
    method !== 'GET'
  ) {
    headers.set('cache-control', 'private, no-store');
  }
}

/**
 * Whether `pathname` is one of `prefixes` or lies below one of them.
 * Matched on whole segments, so `/staffroom` is not under `/staff`.
 */
function matchesAnyPrefix(
  pathname: string,
  prefixes: readonly string[],
): boolean {
  return prefixes.some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
