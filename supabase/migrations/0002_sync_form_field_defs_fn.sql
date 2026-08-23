-- Atomically replaces all `form_field_defs` rows for a tournament with a new
-- set, used by the form-definition upload API.
--
-- PL/pgSQL function bodies run inside the single implicit transaction of the
-- calling statement, so the delete and the bulk insert either both commit or
-- both roll back -- an insert failure can no longer leave the tournament
-- with no form definition. The `for update` lock on the tournament row also
-- serializes concurrent uploads for the same tournament, so two concurrent
-- calls can't both pass the delete and then insert disjoint field sets; the
-- second call blocks until the first commits.
create or replace function sync_form_field_defs(
  p_tournament_id uuid,
  p_rows jsonb
)
returns void
language plpgsql
as $$
declare
  v_found boolean;
begin
  select true into v_found from tournaments where id = p_tournament_id for update;
  if v_found is null then
    raise exception 'tournament % not found', p_tournament_id using errcode = 'P0002';
  end if;

  delete from form_field_defs where tournament_id = p_tournament_id;

  insert into form_field_defs (
    tournament_id, field_key, label, field_type, required, options, display_order
  )
  select
    p_tournament_id,
    elem ->> 'field_key',
    elem ->> 'label',
    elem ->> 'field_type',
    (elem ->> 'required')::boolean,
    nullif(elem -> 'options', 'null'::jsonb),
    (elem ->> 'display_order')::integer
  from jsonb_array_elements(p_rows) as elem;
end;
$$;

revoke all on function sync_form_field_defs(uuid, jsonb) from public;
grant execute on function sync_form_field_defs(uuid, jsonb) to service_role;
