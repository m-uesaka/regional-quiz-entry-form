/**
 * @fileoverview The frontend origins this Worker trusts: what the CSRF check
 * lets a form-like request come from (`index.ts`), and the hostnames a
 * Turnstile token may have been solved on (`middleware/turnstile.ts`).
 */

import type {Bindings} from '../types/env';

/** The last `trustedOrigins()` answer, and the bindings it was read from. */
let trustedOriginsCache:
  {key: string; origins: ReadonlySet<string>} | undefined;

/**
 * The origins the CSRF check lets a form-like request come from:
 * `FRONTEND_URL` and whatever `CSRF_TRUSTED_ORIGINS` adds.
 *
 * Each is reduced to its origin, so a value written with a trailing slash or
 * a path still matches the `scheme://host[:port]` a browser sends. One that
 * is not a URL at all is left out rather than thrown on: a misconfigured
 * binding refuses form posts instead of letting every origin through.
 *
 * Parsed once and kept while the bindings say the same thing -- they are
 * fixed for an isolate's lifetime, so in practice that is once per isolate.
 * @param env The Worker's bindings.
 */
export function trustedOrigins(env: Bindings): ReadonlySet<string> {
  const key = `${env.FRONTEND_URL}\n${env.CSRF_TRUSTED_ORIGINS ?? ''}`;
  if (trustedOriginsCache?.key !== key) {
    const origins = new Set<string>();
    for (const value of [
      env.FRONTEND_URL,
      ...(env.CSRF_TRUSTED_ORIGINS ?? '').split(','),
    ]) {
      try {
        origins.add(new URL(value.trim()).origin);
      } catch {
        // Not a URL; see above.
      }
    }
    trustedOriginsCache = {key, origins};
  }
  return trustedOriginsCache.origins;
}

/**
 * The hostnames of `trustedOrigins()`: where the frontend that renders the
 * Turnstile widget is served from (#297).
 * @param env The Worker's bindings.
 */
export function trustedHostnames(env: Bindings): ReadonlySet<string> {
  return new Set(
    [...trustedOrigins(env)].map(origin => new URL(origin).hostname),
  );
}
