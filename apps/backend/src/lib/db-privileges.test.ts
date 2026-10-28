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

    it('creates new objects in public without granting them to anon or authenticated', async () => {
      // The default privileges the migrations' own objects are created
      // under; `pg_default_acl` holds only the entries that differ from the
      // built-in defaults, under which a function is executable by PUBLIC.
      const rows = await sql`
        select a.defaclobjtype, a.defaclacl::text as acl
        from pg_default_acl a
        join pg_namespace n on n.oid = a.defaclnamespace
        where n.nspname = 'public'
          and pg_get_userbyid(a.defaclrole) = 'postgres'
      `;
      const byType = new Map(
        rows.map((row: {defaclobjtype: string; acl: string}) => [
          row.defaclobjtype,
          row.acl,
        ]),
      );
      for (const type of ['r', 'S', 'f']) {
        expect(byType.get(type)).toBeDefined();
        expect(byType.get(type)).not.toMatch(/(^|[{,])(anon|authenticated)=/);
      }
      // A grant to PUBLIC is spelled `=X/postgres`, with no grantee.
      expect(byType.get('f')).not.toMatch(/(^|[{,])=/);
    });
  },
);
