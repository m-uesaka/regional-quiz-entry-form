import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {isDbReachable} from './db';

// Port 1 is never a Postgres, so the connection is refused straight away
// whether or not a local Supabase happens to be running.
const UNREACHABLE_URL = 'postgresql://postgres:postgres@127.0.0.1:1/postgres';

describe('isDbReachable', () => {
  const required = process.env.REQUIRE_SUPABASE_DB;

  beforeEach(() => {
    delete process.env.REQUIRE_SUPABASE_DB;
  });

  afterEach(() => {
    if (required === undefined) {
      delete process.env.REQUIRE_SUPABASE_DB;
    } else {
      process.env.REQUIRE_SUPABASE_DB = required;
    }
  });

  it('answers false for an unreachable database, so the suite skips', async () => {
    expect(await isDbReachable(UNREACHABLE_URL)).toBe(false);
  });

  it('throws for an unreachable database when one is required', async () => {
    process.env.REQUIRE_SUPABASE_DB = '1';

    await expect(isDbReachable(UNREACHABLE_URL)).rejects.toThrow(
      'REQUIRE_SUPABASE_DB',
    );
  });
});
