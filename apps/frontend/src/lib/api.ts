import {hc} from 'hono/client';
import type {AppType} from '@regional-quiz/backend';

/**
 * Creates a type-safe RPC client for the backend Hono API.
 *
 * @param fetchImpl The `fetch` implementation to use. Pass SvelteKit's
 *     `event.fetch` from a `load` function so that requests are correctly
 *     proxied/credentialed during server-side rendering.
 */
export function createApiClient(fetchImpl: typeof fetch = fetch) {
  return hc<AppType>('/', {fetch: fetchImpl});
}

/**
 * Whether a backend answer is the 401 an expired staff session earns.
 *
 * Hono builds the RPC client's response union out of what the route handlers
 * themselves return, so the 401 the `requireGeneralStaff()` middleware
 * answers with never appears in it — and `res.status === 401` on one of
 * those routes is a comparison TypeScript rejects as impossible. The status
 * is widened here, once, rather than asserted at every call site.
 *
 * @param res The backend response.
 */
export function isUnauthorized(res: {status: number}): boolean {
  return res.status === 401;
}

/**
 * Whether a backend answer is the 404 an id naming no tournament earns.
 *
 * Widened for the same reason as {@link isUnauthorized}: the 404 comes from
 * the `requireOpenEntryPeriodOrStaff()` middleware rather than the route
 * handler, so it is absent from the status union Hono builds the RPC
 * client's response type out of.
 *
 * @param res The backend response.
 */
export function isNotFound(res: {status: number}): boolean {
  return res.status === 404;
}
