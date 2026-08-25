-- Re-checks capacity inside `promote_next_waitlisted_entry`.
--
-- `cancelOwnEntry` commits the cancellation (`cancel_own_entry`) before it
-- calls this function, so the vacated seat is visible to everyone else in
-- between: a `pending_verification` entry whose verification link is clicked
-- in that window confirms into the freed seat, and the promotion that
-- follows would then hand the same seat to the head of the waitlist too,
-- pushing the tournament over `capacity`. Splitting the two calls is what
-- makes the participant's own cancellation survive a promotion failure (see
-- `lib/entries.ts`), so instead of merging them the promotion decides under
-- its own lock: the tournament row is locked exactly as before, and the
-- `confirmed` count is read after that lock is held, so any confirmation
-- that took the seat first is already committed and visible here. When the
-- seat is gone the queue is left untouched and no row is returned, which the
-- caller already treats as "nobody to promote".
--
-- A null `capacity` still means unlimited, in which case there is nothing to
-- exceed and the head of the queue is always promoted.
create or replace function promote_next_waitlisted_entry(p_tournament_id uuid)
returns table(entry_id uuid, participant_email text)
language plpgsql
as $$
declare
  v_capacity integer;
  v_confirmed_count bigint;
  v_entry_id uuid;
  v_participant_email text;
begin
  select capacity into v_capacity
    from tournaments where id = p_tournament_id for update;

  if v_capacity is not null then
    select count(*) into v_confirmed_count
      from entries
      where tournament_id = p_tournament_id and status = 'confirmed';

    if v_confirmed_count >= v_capacity then
      return;
    end if;
  end if;

  select e.id, p.email
    into v_entry_id, v_participant_email
    from entries e
    join participants p on p.id = e.participant_id
    where e.tournament_id = p_tournament_id and e.status = 'waitlisted'
    order by e.waitlist_position asc
    limit 1;

  if v_entry_id is null then
    return;
  end if;

  update entries
    set status = 'confirmed', waitlist_position = null
    where id = v_entry_id;

  entry_id := v_entry_id;
  participant_email := v_participant_email;
  return next;
end;
$$;

revoke all on function promote_next_waitlisted_entry(uuid) from public;
grant execute on function promote_next_waitlisted_entry(uuid) to service_role;
