import {parseSetCookie} from 'set-cookie-parser';
import type {Cookies} from '@sveltejs/kit';

// Mirrors `basePath('/api')` in `apps/backend/src/index.ts`: every URL the
// `hono/client` RPC client builds starts with this.
const API_PATH = '/api';

/**
 * Rewrites a same-origin `/api/*` request so it reaches the backend Worker.
 *
 * SvelteKit's `event.fetch` never puts same-origin requests on the network —
 * it short-circuits them into its own router — and the frontend has no
 * `/api/*` routes, so an untouched SSR call from a `load` function or an
 * action would always 404. Any request that isn't a same-origin `/api/*` one
 * is left alone.
 *
 * The incoming session cookies are re-attached explicitly because SvelteKit
 * only forwards cookies to the frontend's own host and its subdomains, which
 * the backend Worker generally isn't.
 *
 * @param options.request The request `handleFetch` was handed.
 * @param options.frontendUrl `event.url`, i.e. the origin this app is served
 *     from.
 * @param options.backendUrl The backend origin (`BACKEND_URL`).
 * @param options.cookie The `Cookie` header of the request being served, if
 *     any.
 * @return The rewritten request, or `null` when the request isn't an API call
 *     and should be passed through untouched.
 */
export function rewriteApiRequest(options: {
  request: Request;
  frontendUrl: URL;
  backendUrl: string | undefined;
  cookie: string | null;
}): Request | null {
  const {request, frontendUrl, backendUrl, cookie} = options;
  const url = new URL(request.url);
  if (url.origin !== frontendUrl.origin || !isApiPath(url.pathname)) {
    return null;
  }

  const target = new URL(url.pathname + url.search, backendOrigin(backendUrl));
  const rewritten = new Request(target, request);
  // A rewritten request keeps the headers of the original, which for a
  // same-origin request carries no cookies yet.
  if (cookie) rewritten.headers.set('cookie', cookie);
  return rewritten;
}

function isApiPath(pathname: string): boolean {
  return pathname === API_PATH || pathname.startsWith(`${API_PATH}/`);
}

/** Validates `BACKEND_URL` and returns it as an origin to resolve against. */
function backendOrigin(backendUrl: string | undefined): URL {
  if (!backendUrl) {
    throw new Error(
      'BACKEND_URL is not set, so /api/* requests cannot be forwarded to the ' +
        'backend. Copy apps/frontend/.env.example to apps/frontend/.env for ' +
        'local development, or set it on the Cloudflare deployment.',
    );
  }
  try {
    return new URL(backendUrl);
  } catch {
    // `new URL()` rejects anything that isn't absolute; the relative path a
    // misconfigured deployment might hold would otherwise resolve against the
    // frontend origin and silently 404 again.
    throw new Error(`BACKEND_URL is not an absolute URL: ${backendUrl}`);
  }
}

/**
 * Copies the `Set-Cookie` headers of a backend response into SvelteKit's
 * cookie jar, so that they reach the browser on the page response being
 * built.
 *
 * SvelteKit does this on its own for `event.fetch` calls it resolves
 * internally, but not for ones that leave the origin — and
 * `rewriteApiRequest` sends every `/api/*` call to the backend Worker's
 * origin. Without this, the `participant_session` cookie
 * `POST /api/auth/participant/login` answers with would be dropped on the
 * floor and the participant would stay logged out. The deletion the logout
 * endpoints answer with rides back the same way.
 *
 * The parsing is delegated to `set-cookie-parser` — the same library
 * SvelteKit itself uses for this exact job — rather than hand-rolled,
 * because a `Set-Cookie` value is only comma-separable by looking at what
 * each attribute means.
 *
 * `Domain` and `Secure` are deliberately not copied: both describe where the
 * *backend's* cookie may travel, and this cookie is being re-issued by the
 * frontend instead.
 *
 * @param response The response the backend answered with.
 * @param cookies `event.cookies`, i.e. the jar applied to the response this
 *     request is serving.
 * @param url `event.url`, i.e. the frontend origin the cookie is being
 *     re-issued from. Only its protocol is read, to decide `Secure`.
 */
export function forwardBackendCookies(
  response: Response,
  cookies: Cookies,
  url: URL,
): void {
  for (const {name, value, sameSite, ...attributes} of parseSetCookie(
    response.headers.getSetCookie(),
    {decodeValues: false},
  )) {
    // Dropped rather than copied; see the note above. `secure` needs no
    // such removal -- it is overwritten below, after the spread.
    delete attributes.domain;

    // A date the parser could not read comes back as an `Invalid Date`,
    // which makes the `cookie` package's serializer throw and turns a
    // successful login into a 500. Losing one attribute of a cookie that
    // also carries `Max-Age` is the better failure.
    if (attributes.expires && Number.isNaN(attributes.expires.getTime())) {
      delete attributes.expires;
    }

    cookies.set(name, value, {
      ...attributes,
      // `Cookies.set` requires an explicit path. A `Set-Cookie` without one
      // is scoped by the browser to the directory of the request that
      // carried it, which isn't reconstructible here (the request went to
      // the backend origin, the cookie is being set on this one), so the
      // widest scope is used instead. Every cookie the backend sets carries
      // `Path=/` anyway (see `apps/backend/src/routes/participant-auth.ts`).
      path: attributes.path ?? '/',
      sameSite: toSameSite(sameSite),
      // Decided from the frontend's own protocol rather than left to
      // SvelteKit's default, which only drops the flag for the literal
      // hostname `localhost` — `http://127.0.0.1:5173` or `vite dev --host`
      // on a LAN address would otherwise get a `Secure` cookie over plain
      // HTTP, which the browser discards without a word, leaving login
      // silently looping back to the form (and logout silently not logging
      // anyone out).
      secure: url.protocol === 'https:',
      // The parsed value is taken verbatim: it was already encoded by
      // whoever set it, and `Cookies.set` would otherwise encode it a second
      // time.
      encode: cookieValue => cookieValue,
    });
  }
}

/**
 * Narrows a parsed `SameSite` attribute, which is a free-form string, to the
 * values `Cookies.set` accepts.
 *
 * @param value The attribute as it appeared in the header, if at all.
 * @return The lower-cased attribute, or `undefined` when it was absent or
 *     unrecognized — in which case the browser applies its own default.
 */
function toSameSite(
  value: string | undefined,
): 'lax' | 'strict' | 'none' | undefined {
  const normalized = value?.toLowerCase();
  if (
    normalized === 'lax' ||
    normalized === 'strict' ||
    normalized === 'none'
  ) {
    return normalized;
  }
  return undefined;
}
