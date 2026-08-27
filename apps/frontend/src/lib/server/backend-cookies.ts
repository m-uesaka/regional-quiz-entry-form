import type {Cookies} from '@sveltejs/kit';

/** The attributes of a cookie, as `Cookies.set()` takes them. */
type CookieOptions = Parameters<Cookies['set']>[2];

// Only the headers are read, and taking them structurally means the `hono/client`
// `ClientResponse` a route hands over is accepted as readily as a plain
// `Response` — the two are not the same type once the Workers types are in play.
interface SetCookieSource {
  headers: {getSetCookie(): string[]};
}

/**
 * Re-issues the cookies a backend response set, on the response SvelteKit is
 * about to send.
 *
 * `hooks.server.ts` rewrites `/api/*` to the backend Worker's own origin, and
 * SvelteKit only harvests `Set-Cookie` from *same-origin* `event.fetch`
 * responses — a cross-origin one is passed straight through. Without this,
 * the session cookie the login endpoint issues would be dropped server-side
 * and never reach the browser.
 *
 * @param response The backend response to copy `Set-Cookie` headers from.
 * @param cookies The request event's `cookies`.
 * @param url The request event's `url`, i.e. the frontend origin the cookie
 *     is being re-issued from. Only its protocol is read, to decide `Secure`.
 */
export function forwardSetCookies(
  response: SetCookieSource,
  cookies: Cookies,
  url: URL,
): void {
  for (const header of response.headers.getSetCookie()) {
    const parsed = parseSetCookie(header, url);
    if (parsed) {
      cookies.set(parsed.name, parsed.value, parsed.options);
    }
  }
}

/**
 * Parses one `Set-Cookie` header value.
 *
 * `Domain` and `Secure` are deliberately not copied: both describe where the
 * *backend's* cookie may travel, and this cookie is being re-issued by the
 * frontend instead. `Secure` is decided from the frontend's own protocol
 * rather than left to SvelteKit's default, which only drops the flag for the
 * literal hostname `localhost` — `http://127.0.0.1:5173` or `vite dev --host`
 * on a LAN address would otherwise get a `Secure` cookie over plain HTTP,
 * which the browser discards without a word, leaving login silently looping
 * back to the form.
 *
 * @param header The raw header value.
 * @param url The frontend origin the cookie is being re-issued from.
 * @return The cookie, or `null` if the header has no `name=value` pair.
 */
function parseSetCookie(
  header: string,
  url: URL,
): {name: string; value: string; options: CookieOptions} | null {
  const [pair, ...attributes] = header.split(';');
  const separator = pair.indexOf('=');
  if (separator <= 0) return null;

  const options: CookieOptions = {
    // Browsers default a path-less cookie to the directory of the request
    // URL, which for `/api/auth/staff/login` would scope it to `/api/auth`
    // and hide it from every page. The backend always sends `Path=/`; this
    // only decides what an attribute-less header means.
    path: '/',
    secure: url.protocol === 'https:',
    // The value is a JWT that SvelteKit would otherwise percent-encode a
    // second time on the way out.
    encode: value => value,
  };
  for (const attribute of attributes) {
    const nameEnd = attribute.indexOf('=');
    const name = (
      nameEnd === -1 ? attribute : attribute.slice(0, nameEnd)
    ).trim();
    const value = nameEnd === -1 ? '' : attribute.slice(nameEnd + 1).trim();
    applyAttribute(options, name.toLowerCase(), value);
  }

  return {
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1).trim(),
    options,
  };
}

/**
 * Applies one parsed `Set-Cookie` attribute to `options`, ignoring the ones
 * that don't survive the hand-off (see `parseSetCookie`) and any the backend
 * may grow later that this app has no opinion about.
 *
 * @param options The options being built up.
 * @param name The attribute name, lowercased.
 * @param value The attribute value, empty for a valueless attribute.
 */
function applyAttribute(
  options: CookieOptions,
  name: string,
  value: string,
): void {
  switch (name) {
    case 'path':
      options.path = value;
      break;
    case 'max-age':
      options.maxAge = Number(value);
      break;
    case 'expires': {
      // A date `Date` can't parse would reach `cookies.set()` as an
      // `Invalid Date`, which makes the `cookie` package's serializer throw
      // and turns a successful login into a 500. Losing one attribute of a
      // cookie that also carries `Max-Age` is the better failure.
      const expires = new Date(value);
      if (!Number.isNaN(expires.getTime())) {
        options.expires = expires;
      }
      break;
    }
    case 'httponly':
      options.httpOnly = true;
      break;
    case 'samesite':
      options.sameSite = normalizeSameSite(value);
      break;
    default:
      break;
  }
}

/**
 * Narrows a `SameSite` attribute value to what `Cookies.set()` accepts. The
 * attribute is case-insensitive on the wire (`hono/cookie` writes `Lax`),
 * but the `cookie` package's serializer only recognizes it lowercased.
 *
 * @param value The raw attribute value.
 * @return The lowercased value, or `undefined` if it isn't a known one.
 */
function normalizeSameSite(value: string): CookieOptions['sameSite'] {
  switch (value.toLowerCase()) {
    case 'lax':
      return 'lax';
    case 'strict':
      return 'strict';
    case 'none':
      return 'none';
    default:
      return undefined;
  }
}
