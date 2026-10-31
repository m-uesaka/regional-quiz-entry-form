import {SQL} from 'bun';

/**
 * The local Supabase Postgres (`supabase start` default). Overridable via
 * `SUPABASE_DB_URL` for other local setups.
 */
export const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Decides whether a test file's integration suites run, for
 * `describe.skipIf(!(await isDbReachable()))`.
 *
 * Without a database the answer is `false`, so `bun test` stays usable with
 * no Docker around, and so does the CI job and the deploy workflow that run
 * the unit tests with no stack up. The `integration` job in
 * `.github/workflows/ci.yml` sets `REQUIRE_SUPABASE_DB` instead, which turns
 * an unreachable database into a thrown error: a skip there would be a green
 * run that tested nothing. It is a variable of its own rather than `CI`
 * because those other runs are on CI as well. Only `1` turns it on, so `0`
 * or `false` read the way they look.
 * @param url The Postgres connection string to probe.
 * @return Whether `url` answered a query.
 * @throws Error If it did not and `REQUIRE_SUPABASE_DB` is `1`.
 */
export async function isDbReachable(url: string = DB_URL): Promise<boolean> {
  const probe = new SQL(url);
  try {
    await probe`select 1`;
    return true;
  } catch (cause) {
    if (process.env.REQUIRE_SUPABASE_DB === '1') {
      throw new Error(
        'REQUIRE_SUPABASE_DB is set, but the database did not answer',
        {cause},
      );
    }
    return false;
  } finally {
    await probe.close();
  }
}
