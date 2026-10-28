-- Takes everything in `public` away from the Data API roles, `anon` and
-- `authenticated`, and keeps it from them for objects created later (#194).
--
-- Nothing reaches the database through them: the backend connects with the
-- secret key (`service_role`), and no client is handed the publishable key.
-- But Supabase's default privileges give every table, sequence and function
-- created in `public` to both roles, and the per-object revokes the earlier
-- migrations repeat did not cover all of it:
--
-- - `entry_regulations` (`0018`) never revoked them, so both roles still
--   hold TRUNCATE, REFERENCES and TRIGGER on it;
-- - `tournaments_display_order_seq` (`0032`) left them UPDATE, i.e.
--   `nextval()` and `setval()`;
-- - `revoke all on function ... from public`, which each function's
--   migration does, takes back the grant to PUBLIC but not a default
--   privilege granted to `anon` / `authenticated` by name, and the two
--   trigger functions (`set_updated_at()`, `check_region_dual_entry()`)
--   never revoked even PUBLIC's.
--
-- None of it was exploitable -- RLS is on with no policies, and every
-- function is SECURITY INVOKER -- but the first SECURITY DEFINER function, or
-- the first table that forgot its revoke, would have been callable or
-- readable with the publishable key alone.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
-- PUBLIC as well: a function's own migration revokes it, but the trigger
-- functions' never did. Every function the backend calls is granted to
-- `service_role` by name, and a trigger function needs no EXECUTE grant to
-- fire, so nothing loses access it uses.
revoke all on all functions in schema public from public, anon, authenticated;

-- For objects the migrations create from here on, which run as `postgres`.
-- A new table, sequence or function then starts out with no grant to the Data
-- API roles at all, instead of relying on its migration to remember the
-- revoke; it still has to grant `service_role` what the backend needs, as
-- every migration so far does.
--
-- The schema-level entries take away what Supabase's own schema-level
-- defaults hand the two roles by name.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;
-- PUBLIC's EXECUTE on a new function is not one of those: it is Postgres'
-- built-in default, and a schema-level entry can only add to the built-in
-- defaults, never take from them -- `in schema public` here would be
-- accepted and change nothing. So this one is revoked globally, for every
-- function `postgres` creates in any schema. The migrations create functions
-- in `public` only.
alter default privileges for role postgres
  revoke execute on functions from public;
