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
