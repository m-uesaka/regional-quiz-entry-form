/**
 * Hashes `password` the way `hashPassword()` did before the stored format
 * named its algorithm and iteration count: `<saltHex>:<hashHex>` at 100,000
 * iterations of PBKDF2-HMAC-SHA256. Lives here rather than in
 * `lib/password.ts` because production code must never write this format
 * again; tests need it to stand in for the rows already in the database.
 * @param password The password to hash.
 */
export async function legacyHashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256'},
    key,
    256,
  );
  const hex = (bytes: Uint8Array): string =>
    Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex(salt)}:${hex(new Uint8Array(bits))}`;
}

/** A `password_hash` write the mock below received. */
export interface PasswordHashUpdate {
  /** The table, e.g. `participants`. */
  table: string;
  /** The PostgREST filters, e.g. `id=eq.<id>&password_hash=eq.<hash>`. */
  filters: URLSearchParams;
  /** The hash written. */
  passwordHash: string;
}

/**
 * Stands in for Supabase on a login: every read answers with `row`, and every
 * `PATCH` (the rehash) is recorded and answered with success -- or with a
 * 500 when `failUpdate` is set.
 * @param row The account row the login looks up.
 * @param options.failUpdate Makes the rehash write fail.
 * @return The writes received so far, appended to as they arrive.
 */
export function mockAccountFetchWithRehash(
  row: Record<string, unknown>,
  options: {failUpdate?: boolean} = {},
): PasswordHashUpdate[] {
  const updates: PasswordHashUpdate[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (init?.method === 'PATCH') {
      updates.push({
        table: url.pathname.replace('/rest/v1/', ''),
        filters: url.searchParams,
        passwordHash: (JSON.parse(String(init.body)) as {password_hash: string})
          .password_hash,
      });
      return options.failUpdate
        ? Response.json({message: 'boom'}, {status: 500})
        : new Response(null, {status: 204});
    }
    return Response.json([row]);
  }) as unknown as typeof fetch;
  return updates;
}

/**
 * An `ExecutionContext` that collects what a handler defers with
 * `waitUntil()`, so a test can wait for it the way Cloudflare would after the
 * response.
 */
export function collectingExecutionContext(): {
  ctx: ExecutionContext;
  settle: () => Promise<void>;
} {
  const pending: Array<Promise<unknown>> = [];
  return {
    ctx: {
      waitUntil(promise: Promise<unknown>): void {
        pending.push(promise);
      },
      passThroughOnException(): void {},
    } as unknown as ExecutionContext,
    settle: async () => {
      await Promise.all(pending.splice(0));
    },
  };
}
