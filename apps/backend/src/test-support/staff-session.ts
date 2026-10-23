// Fixtures for the session check every staff guard makes
// (`isSessionCurrent()` in `middleware/staff-auth.ts`): before a staff
// request reaches its handler, the guard reads the account's
// `staff_accounts.sessions_valid_from` and compares it with the token's
// `sessionsValidFrom` claim. Every test that sends a staff cookie through
// one of those guards has to answer that read, whether or not revocation is
// what the test is about.
//
// Not imported by `src/index.ts`, so none of this reaches the deployed
// Worker: `wrangler deploy` bundles from that entry point outwards.

/**
 * The `sessions_valid_from` the stub below reports, and so the generation
 * every test token should carry. Deliberately not a whole second, so a
 * comparison that truncated either side would show up as a failure.
 */
export const TEST_SESSIONS_VALID_FROM = '2026-08-25T01:23:45.678Z';

/** `TEST_SESSIONS_VALID_FROM` as the claim spells it. */
export const TEST_SESSIONS_VALID_FROM_MS = Date.parse(TEST_SESSIONS_VALID_FROM);

/** Whether `url` is the guards' `sessions_valid_from` lookup. */
export function isStaffSessionCheck(url: string): boolean {
  const parsed = new URL(url);
  return (
    parsed.pathname.endsWith('/rest/v1/staff_accounts') &&
    parsed.searchParams.get('select') === 'sessions_valid_from'
  );
}

/**
 * Answers the staff guards' session check with `sessionsValidFrom`, and
 * everything else with `fetchImpl`.
 *
 * Only that one read is answered: the staff account routes query
 * `staff_accounts` themselves, and those calls go to `fetchImpl` like any
 * other. This also means the integration suites can wrap the real `fetch`
 * with it and still reach the local stack for everything they are about,
 * without having to seed an account for every token they sign.
 *
 * @param fetchImpl The stub (or real `fetch`) for every other call.
 * @param sessionsValidFrom What the account's row should say, or `null` for
 *     an account that no longer exists.
 */
export function staffSessionAwareFetch(
  fetchImpl: typeof fetch,
  sessionsValidFrom: string | null = TEST_SESSIONS_VALID_FROM,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      input instanceof Request
        ? input.url
        : typeof input === 'string'
          ? input
          : input.toString();
    if (isStaffSessionCheck(url)) {
      return Promise.resolve(
        Response.json(
          sessionsValidFrom === null
            ? []
            : [{sessions_valid_from: sessionsValidFrom}],
        ),
      );
    }
    return fetchImpl(input as RequestInfo, init);
  }) as unknown as typeof fetch;
}
