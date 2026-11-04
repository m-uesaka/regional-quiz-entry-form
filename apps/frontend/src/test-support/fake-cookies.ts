import type {Cookies} from '@sveltejs/kit';

/**
 * A stand-in for `event.cookies` that can only delete, recording the names
 * it was asked to: a session the API refuses is dropped on the way to the
 * login screen. Any other call throws, so a page that starts reading or
 * writing cookies has to say so in its test.
 * @param deleted Collects the deleted cookie names.
 */
export function fakeCookies(deleted: string[] = []): Cookies {
  return {
    delete: (name: string) => {
      deleted.push(name);
    },
  } as unknown as Cookies;
}

/** A cookie jar standing in for `event.cookies`, and what it recorded. */
export interface FakeCookieJar {
  cookies: Cookies;
  /** The cookies the request carries; `set()` writes and `delete()` drops. */
  jar: Map<string, string>;
  /** The options each `set()` was last called with, by cookie name. */
  setOptions: Map<string, unknown>;
  /** The names `delete()` was called with, in order. */
  deleted: string[];
}

/**
 * Builds a cookie jar standing in for `event.cookies`, for pages that read
 * and write cookies of their own rather than only dropping a session.
 * @param initial The cookies the request carries.
 */
export function fakeCookieJar(
  initial: Record<string, string> = {},
): FakeCookieJar {
  const deleted: string[] = [];
  const jar = new Map(Object.entries(initial));
  const setOptions = new Map<string, unknown>();
  const cookies = {
    get: (name: string) => jar.get(name),
    set: (name: string, value: string, options: unknown) => {
      jar.set(name, value);
      setOptions.set(name, options);
    },
    delete: (name: string) => {
      deleted.push(name);
      jar.delete(name);
    },
  } as unknown as Cookies;
  return {cookies, jar, setOptions, deleted};
}
