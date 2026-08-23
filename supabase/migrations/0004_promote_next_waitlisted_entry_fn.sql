-- Atomically claims and promotes the waitlisted entry with the smallest
-- `waitlist_position` for a tournament, used when a confirmed entry
-- vacates a seat.
--
-- The PL/pgSQL body runs inside the calling statement's single implicit
-- transaction, and `for update` on the tournament row serializes concurrent
-- promotions for the same tournament: a second concurrent call blocks until
-- the first commits, at which point the promoted row's status is already
-- `confirmed` and won't be selected again. This prevents two simultaneous
-- vacancies from both selecting the same waitlisted entry, which would
-- otherwise promote only one participant, send duplicate notifications, and
-- leave a seat unused.
create or replace function promote_next_waitlisted_entry(p_tournament_id uuid)
returns table(entry_id uuid, participant_email text)
language plpgsql
as $$
declare
  v_entry_id uuid;
  v_participant_email text;
begin
  perform 1 from tournaments where id = p_tournament_id for update;

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
