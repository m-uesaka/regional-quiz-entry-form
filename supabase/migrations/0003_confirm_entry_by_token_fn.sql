-- Atomically confirms (or waitlists) the entry a verification token was
-- issued for, used by the email-verification API.
--
-- The PL/pgSQL body runs inside the calling statement's single implicit
-- transaction, so the token lookup, the capacity/waitlist counts, and the
-- entries/token updates either all commit or all roll back. `for update of
-- evt` locks the token row for the duration, so a second call that replays
-- the same token blocks until the first commits and then observes
-- `used_at` already set, instead of both calls reading it unused and
-- overwriting each other's placement. Locking the tournament row similarly
-- serializes concurrent confirmations for the same tournament, so two
-- requests can no longer both read the same `confirmed` count and both
-- squeeze in under capacity.
create or replace function confirm_entry_by_token(p_token_hash text)
returns entry_status
language plpgsql
as $$
declare
  v_token_id uuid;
  v_entry_id uuid;
  v_expires_at timestamptz;
  v_used_at timestamptz;
  v_tournament_id uuid;
  v_capacity integer;
  v_confirmed_count bigint;
  v_waitlisted_count bigint;
  v_status entry_status;
  v_waitlist_position integer;
begin
  select evt.id, evt.entry_id, evt.expires_at, evt.used_at, e.tournament_id
    into v_token_id, v_entry_id, v_expires_at, v_used_at, v_tournament_id
    from email_verification_tokens evt
    join entries e on e.id = evt.entry_id
    where evt.token_hash = p_token_hash
    for update of evt;

  if v_token_id is null or v_used_at is not null or v_expires_at < now() then
    raise exception 'invalid or expired token' using errcode = 'P0003';
  end if;

  select capacity into v_capacity
    from tournaments where id = v_tournament_id for update;

  select count(*) into v_confirmed_count
    from entries
    where tournament_id = v_tournament_id and status = 'confirmed';

  if v_capacity is not null and v_confirmed_count >= v_capacity then
    v_status := 'waitlisted';
    select count(*) into v_waitlisted_count
      from entries
      where tournament_id = v_tournament_id and status = 'waitlisted';
    v_waitlist_position := v_waitlisted_count + 1;
  else
    v_status := 'confirmed';
    v_waitlist_position := null;
  end if;

  update entries
    set status = v_status,
        email_verified_at = now(),
        waitlist_position = v_waitlist_position
    where id = v_entry_id;

  update email_verification_tokens
    set used_at = now()
    where id = v_token_id;

  return v_status;
end;
$$;

revoke all on function confirm_entry_by_token(text) from public;
grant execute on function confirm_entry_by_token(text) to service_role;
