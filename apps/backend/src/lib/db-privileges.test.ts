import {afterAll, describe, expect, it} from 'bun:test';
import {SQL} from 'bun';

// Local Supabase Postgres connection (`supabase start` default). Overridable
// via SUPABASE_DB_URL for other local setups.
const DB_URL =
  process.env.SUPABASE_DB_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function isDbReachable(): Promise<boolean> {
  const probe = new SQL(DB_URL);
  try {
    await probe`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.close();
  }
}

const dbReachable = await isDbReachable();

// The Data API roles. Nothing connects as them, so nothing in `public` may be
// granted to them (`0035_revoke_data_api_default_privileges.sql`, #194).
const DATA_API_ROLES = ['anon', 'authenticated'];

// Requires a running local Supabase instance (`supabase start`); skipped
// automatically when one isn't reachable, e.g. in CI.
describe.skipIf(!dbReachable)(
  'Data API role privileges (local Supabase integration)',
  () => {
    const sql = new SQL(DB_URL);

    afterAll(async () => {
      await sql.close();
    });

    it('grants no table or sequence in public to anon or authenticated', async () => {
      const rows = await sql`
        select c.relname, r.rolname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join pg_roles r
        where n.nspname = 'public'
          and c.relkind in ('r', 'p', 'v', 'm', 'S')
          and r.rolname in ${sql(DATA_API_ROLES)}
          and exists (
            select 1 from aclexplode(c.relacl) a where a.grantee = r.oid
          )
      `;
      expect(rows).toEqual([]);
    });

    it('lets neither anon nor authenticated execute a function in public', async () => {
      // `has_function_privilege` counts a grant to PUBLIC too.
      const rows = await sql`
        select p.proname, r.rolname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join pg_roles r
        where n.nspname = 'public'
          and r.rolname in ${sql(DATA_API_ROLES)}
          and has_function_privilege(r.oid, p.oid, 'execute')
      `;
      expect(rows).toEqual([]);
    });

    // Checked on objects actually created, not on `pg_default_acl`: PUBLIC's
    // EXECUTE on a new function is a built-in default that never shows up
    // there, so reading the catalog alone would miss it coming back.
    it('creates new objects in public without granting them to anon or authenticated', async () => {
      const rolledBack = new Error('rolled back');
      let rows: unknown[] = [];
      await sql
        .begin(async tx => {
          await tx`create table public.db_privileges_probe (id int)`;
          await tx`create sequence public.db_privileges_probe_seq`;
          await tx`
            create function public.db_privileges_probe()
            returns int language sql as 'select 1'
          `;
          rows = await tx`
            select r.rolname, privilege
            from pg_roles r
            cross join lateral (values
              ('table', has_table_privilege(
                r.oid, 'public.db_privileges_probe',
                'select, insert, update, delete, truncate, references, trigger'
              )),
              ('sequence', has_sequence_privilege(
                r.oid, 'public.db_privileges_probe_seq', 'usage, select, update'
              )),
              ('function', has_function_privilege(
                r.oid, 'public.db_privileges_probe()', 'execute'
              ))
            ) as p(privilege, granted)
            where r.rolname in ${sql(DATA_API_ROLES)} and p.granted
          `;
          throw rolledBack;
        })
        .catch(error => {
          if (error !== rolledBack) throw error;
        });
      expect(rows).toEqual([]);
    });
  },
);
