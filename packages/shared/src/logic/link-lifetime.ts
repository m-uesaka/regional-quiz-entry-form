const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * How long a mailed link stays usable, as both the mail and the page that
 * sends someone to it state it: in hours when it is a whole number of them,
 * in minutes otherwise, so a lifetime that isn't never reads as 「1.5時間」.
 * Minutes round down, so neither ever promises longer than the link
 * actually lasts.
 * @param ttlMs The link's lifetime.
 */
export function formatLinkLifetime(ttlMs: number): string {
  return ttlMs % HOUR_MS === 0
    ? `${ttlMs / HOUR_MS}時間`
    : `${Math.floor(ttlMs / MINUTE_MS)}分`;
}
