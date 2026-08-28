-- Atomically brings a tournament's `regulations` rows in line with a new
-- set, used by the regulation save API.
--
-- Unlike `sync_form_field_defs()` (migration 0002) this can't delete and
-- re-insert: `entries` references `regulations` by the composite foreign
-- key `(regulation_id, tournament_id)`, so wiping the table would fail on
-- every tournament that already has entries -- and even where it didn't,
-- re-inserting would hand the existing entries new regulation ids. Rows
-- named by id are updated in place, rows without one are inserted, and rows
-- that disappeared from the request are deleted only when no entry refers
-- to them (otherwise the whole call is rejected).
--
-- Like 0002, the tournament row is locked for the duration so two
-- concurrent saves for the same tournament can't interleave and merge into
-- a set neither of them asked for.
create or replace function sync_regulations(
  p_tournament_id uuid,
  p_regulations jsonb
)
returns void
language plpgsql
as $$
declare
  v_keep uuid[];
  v_unknown uuid[];
  v_in_use text[];
begin
  perform 1 from tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament not found: %', p_tournament_id
      using errcode = 'P0002';
  end if;

  -- An id that names a row of *another* tournament must not be accepted:
  -- the upsert below would otherwise silently rewrite that tournament's
  -- regulation instead of touching this one's. An id that names nothing at
  -- all is just as likely to be a stale client, so both are rejected
  -- rather than quietly turned into an insert.
  select array_agg(i.id) into v_unknown
  from (
    select (value ->> 'id')::uuid as id
    from jsonb_array_elements(p_regulations)
  ) i
  where i.id is not null
    and not exists (
      select 1 from regulations r
      where r.id = i.id and r.tournament_id = p_tournament_id
    );
  if v_unknown is not null then
    raise exception 'unknown regulations'
      using errcode = 'P0003', detail = array_to_string(v_unknown, ', ');
  end if;

  -- Existing rows updated, new ones inserted; `display_order` is the
  -- position in the request array.
  with input as (
    select
      (value ->> 'id')::uuid as id,
      value ->> 'label' as label,
      (value ->> 'priorityStartsAt')::timestamptz as priority_starts_at,
      (value ->> 'priorityEndsAt')::timestamptz as priority_ends_at,
      (ordinality - 1)::integer as display_order
    from jsonb_array_elements(p_regulations) with ordinality
  ),
  upserted as (
    insert into regulations (
      id, tournament_id, label, priority_starts_at, priority_ends_at,
      display_order
    )
    select
      coalesce(i.id, gen_random_uuid()), p_tournament_id, i.label,
      i.priority_starts_at, i.priority_ends_at, i.display_order
    from input i
    on conflict (id) do update set
      label = excluded.label,
      priority_starts_at = excluded.priority_starts_at,
      priority_ends_at = excluded.priority_ends_at,
      display_order = excluded.display_order
    returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_keep from upserted;

  -- Rows about to disappear that an entry still points at. The labels go
  -- in `detail` rather than the message so the caller can build its own
  -- staff-facing sentence around them: a label is what the staff member
  -- sees in the form they just submitted.
  select array_agg(r.label order by r.display_order) into v_in_use
  from regulations r
  where r.tournament_id = p_tournament_id
    and not (r.id = any (v_keep))
    and exists (select 1 from entries e where e.regulation_id = r.id);
  if v_in_use is not null then
    raise exception 'regulations in use'
      using errcode = 'P0004', detail = array_to_string(v_in_use, '、');
  end if;

  delete from regulations r
  where r.tournament_id = p_tournament_id and not (r.id = any (v_keep));
end;
$$;

revoke all on function sync_regulations(uuid, jsonb) from public;
grant execute on function sync_regulations(uuid, jsonb) to service_role;

-- A priority window is either absent or complete. Held here as well as in
-- the Zod schema because setting regulations straight through SQL stays a
-- supported operation, and a half-open window would make
-- `isRegulationSelectionAllowed()` treat the regulation as unrestricted.
alter table regulations
  add constraint regulations_priority_window_complete
  check (
    (priority_starts_at is null) = (priority_ends_at is null)
    and (priority_starts_at is null or priority_starts_at < priority_ends_at)
  );

-- `where tournament_id = ?` can't use `unique (id, tournament_id)`, whose
-- leading column is `id`. The entry form reads this on every render.
create index regulations_tournament_id_display_order_idx
  on regulations (tournament_id, display_order);
