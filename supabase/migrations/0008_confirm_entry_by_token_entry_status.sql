-- Refuses confirmation of an entry that is no longer awaiting verification,
-- inside `confirm_entry_by_token`.
--
-- A valid, unused token is not enough on its own: the entry it was issued
-- for is re-read under the tournament lock and the confirmation is refused
-- unless it is still `pending_verification`. `cancel_own_entry` burns the
-- tokens outstanding when it runs, but a re-entry racing a cancellation can
-- insert a fresh token that the cancellation never sees, and without this
-- check that link would later resurrect the cancelled entry. Reading the
-- status only after `for update` on the tournament row is what makes the
-- check reliable: `cancel_own_entry` holds that same lock while it flips the
-- entry to `cancelled`, so a confirmation that started first blocks here and
-- then observes the cancellation instead of overwriting it.
--
-- The function is redefined here rather than edited in
-- `0003_confirm_entry_by_token_fn.sql`, which is already applied everywhere:
-- `supabase db push` runs a version once and never re-runs it, so an
-- in-place edit would silently leave this check out of every environment
-- except a freshly reset one. `0007_promote_next_waitlisted_entry_capacity`
-- amends `0004` the same way.
--
-- Everything else is carried over from `0003` unchanged: the token row is
-- locked first and the tournament row second, matching the order
-- `cancel_own_entry` takes them in so the two can't deadlock, and the
-- capacity check that decides `confirmed` vs `waitlisted` still runs under
-- the tournament lock.
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
  v_entry_status entry_status;
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

  -- Re-read under the lock: a concurrent cancellation may have moved the
  -- entry since the token lookup above.
  select e.status into v_entry_status from entries e where e.id = v_entry_id;

  if v_entry_status <> 'pending_verification' then
    raise exception 'entry is not awaiting verification'
      using errcode = 'P0003';
  end if;

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
