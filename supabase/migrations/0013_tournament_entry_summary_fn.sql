-- Aggregates every tournament's entry counts for the general-staff
-- dashboard (`GET /api/staff/dashboard`).
--
-- Unlike the other DB functions in this schema, this one needs no atomicity
-- or locking -- it exists because the equivalent through the Data API would
-- be one `entries` query per tournament (or a full table scan pulled into
-- the Worker just to be counted there), and the dashboard reads every
-- region at once. `stable` and `language sql` because it only reads.
--
-- The `left join` is what keeps a tournament with no entries on the
-- dashboard at all: `count(*) filter (...)` skips the null-extended row, so
-- such a tournament reports zeros rather than disappearing. Region and
-- tournament names travel with the counts so the dashboard doesn't have to
-- join them back on the client, and every column is referenced
-- table-qualified so it can't be read as one of the `returns table` output
-- names. The counts are cast down from `count()`'s `bigint` to `integer` so
-- they cross PostgREST as plain JSON numbers -- an entry count can't
-- approach `integer`'s range, and `bigint` would risk arriving as a string.
create or replace function tournament_entry_summary()
returns table (
  tournament_id uuid,
  tournament_name text,
  tournament_type tournament_type,
  region_id uuid,
  region_slug text,
  region_name text,
  capacity integer,
  confirmed_count integer,
  waitlisted_count integer,
  pending_verification_count integer,
  cancelled_count integer
)
language sql
stable
as $$
  select
    t.id,
    t.name,
    t.type,
    r.id,
    r.slug,
    r.name,
    t.capacity,
    count(*) filter (where e.status = 'confirmed')::integer,
    count(*) filter (where e.status = 'waitlisted')::integer,
    count(*) filter (where e.status = 'pending_verification')::integer,
    count(*) filter (where e.status = 'cancelled')::integer
  from tournaments t
  join regions r on r.id = t.region_id
  left join entries e on e.tournament_id = t.id
  group by t.id, r.id
  order by r.name, t.type;
$$;

revoke all on function tournament_entry_summary() from public;
grant execute on function tournament_entry_summary() to service_role;
