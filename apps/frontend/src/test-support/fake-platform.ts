/**
 * A stand-in for Cloudflare's `platform`, for tests of the code that uses
 * its cache. `caches.default` is a `Map` keyed by the URL string the code
 * passes, and `waitUntil` collects the promises so a test can await them.
 */
export function fakePlatform(options: {failDelete?: boolean} = {}) {
  const stored = new Map<string, Response>();
  const pending: Array<Promise<unknown>> = [];
  const platform = {
    caches: {
      default: {
        match: (key: string) => Promise.resolve(stored.get(key)),
        put: (key: string, res: Response) => {
          stored.set(key, res);
          return Promise.resolve();
        },
        delete: (key: string) =>
          options.failDelete
            ? Promise.reject(new Error('cache unavailable'))
            : Promise.resolve(stored.delete(key)),
      },
    },
    ctx: {waitUntil: (p: Promise<unknown>) => pending.push(p)},
  } as unknown as App.Platform;
  return {platform, stored, settled: () => Promise.all(pending)};
}

/**
 * The cache key of the public list of tokyo / saikyoi's version: the key a
 * drop deletes, and so the one the tests check (see
 * `$lib/server/entry-list-cache`).
 */
export const TOKYO_SAIKYOI_LIST_KEY =
  'http://localhost/__cache/entry-list/tokyo/saikyoi/version';
