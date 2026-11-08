import {SQL} from 'bun';

/**
 * The local Supabase Postgres (`supabase start` default). Overridable via
 * `SUPABASE_DB_URL` for other local setups.
 */
export const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * The local Supabase API the integration suites point `SUPABASE_URL` at.
 * Overridable via `SUPABASE_URL`.
 */
export const SUPABASE_URL =
  process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

/**
 * The service role key for that API. The default is the publicly documented
 * demo key the Supabase CLI issues for its default local stack (signed with
 * the fixed `super-secret-jwt-token-with-at-least-32-characters-long`
 * secret) -- not a real credential, safe to commit. Overridable via
 * `SUPABASE_SECRET_KEY` for a CLI that issues another.
 *
 * `apps/e2e/support/env.ts` keeps its own copy: Playwright runs it on Node,
 * and this module imports `bun`.
 */
export const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    'eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.' +
    'EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

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
