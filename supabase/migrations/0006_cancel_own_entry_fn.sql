-- Atomically cancels a participant's own entry, used by
-- `DELETE /mypage/entries/:entryId`.
--
-- The PL/pgSQL body runs inside the calling statement's single implicit
-- transaction. It takes the same locks as `confirm_entry_by_token`, in the
-- same order (the entry's verification tokens first, then the tournament
-- row) so the two can't deadlock against each other, and
-- `promote_next_waitlisted_entry` locks the tournament row too. Three things
-- depend on that:
--
--   * Any verification token still outstanding for the entry is burned, so
--     an entry cancelled before it was ever verified can't be confirmed
--     afterwards by clicking the link from the email that is still sitting
--     in the participant's inbox. A token a concurrent re-entry inserts
--     after this burn is not covered here, but `confirm_entry_by_token`
--     also refuses any entry that is no longer `pending_verification`,
--     which it checks under the same tournament lock this function takes
--     below.
--   * The prior status is read and overwritten under the tournament lock and
--     is returned only once, so two concurrent cancellations of the same
--     `confirmed` entry can't both see `confirmed` and both trigger a
--     promotion for one vacated seat.
--   * Cancelling a waitlisted entry closes the gap it leaves in the queue by
--     shifting every entry behind it forward one place. Waitlist positions
--     stay contiguous, which keeps the position shown to participants an
--     accurate rank and keeps `confirm_entry_by_token`'s "next position =
--     waitlisted count + 1" from handing out a position that is already
--     taken.
--
-- Returns no row when the entry doesn't exist or belongs to another
-- participant, so the caller can answer 404 without being able to tell the
-- two apart. Cancelling an already-cancelled entry is a no-op that still
-- returns its (`cancelled`) prior status, making the endpoint idempotent.
create or replace function cancel_own_entry(
  p_entry_id uuid,
  p_participant_id uuid
)
returns table(previous_status entry_status, entry_tournament_id uuid)
language plpgsql
as $$
declare
  v_tournament_id uuid;
  v_status entry_status;
  v_waitlist_position integer;
begin
  select e.tournament_id into v_tournament_id
    from entries e
    where e.id = p_entry_id and e.participant_id = p_participant_id;

  if v_tournament_id is null then
    return;
  end if;

  update email_verification_tokens
    set used_at = now()
    where entry_id = p_entry_id and used_at is null;

  perform 1 from tournaments t where t.id = v_tournament_id for update;

  -- Re-read under the lock: a concurrent confirmation, promotion or
  -- cancellation may have moved the entry since the lookup above.
  select e.status, e.waitlist_position into v_status, v_waitlist_position
    from entries e
    where e.id = p_entry_id;

  if v_status <> 'cancelled' then
    update entries
      set status = 'cancelled',
          cancelled_at = now(),
          waitlist_position = null
      where id = p_entry_id;

    if v_waitlist_position is not null then
      update entries e
        set waitlist_position = e.waitlist_position - 1
        where e.tournament_id = v_tournament_id
          and e.status = 'waitlisted'
          and e.waitlist_position > v_waitlist_position;
    end if;
  end if;

  previous_status := v_status;
  entry_tournament_id := v_tournament_id;
  return next;
end;
$$;

revoke all on function cancel_own_entry(uuid, uuid) from public;
grant execute on function cancel_own_entry(uuid, uuid) to service_role;
