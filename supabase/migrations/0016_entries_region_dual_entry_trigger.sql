-- Backstop for the `regions.allows_dual_entry` rule (migration 0015), which
-- `createEntry()` in `apps/backend/src/lib/entries.ts` otherwise enforces by
-- counting the participant's other entries and then inserting. Two
-- submissions for the region's two tournaments that interleave inside that
-- window both count zero and both insert, leaving the participant holding
-- both seats with no code path that takes one back.
--
-- `for update` on the participant row is what closes it: the second
-- transaction blocks there until the first commits, and then sees the row it
-- just wrote. The participant is the contended resource here, so locking it
-- (rather than the region, which every entry in the region shares) keeps
-- unrelated submissions from serializing behind each other.
--
-- The check is skipped unless the row is *taking* a seat -- an insert, or a
-- re-entry updating the participant's own cancelled row. A status change on
-- a row that already holds one (`pending_verification` -> `confirmed`,
-- waitlist promotion) passed this check when the seat was taken, and
-- re-running it would make those paths take a participant lock while
-- already holding the tournament lock that `promote_next_waitlisted_entry()`
-- and `confirm_entry_by_token()` acquire.
create or replace function check_region_dual_entry()
returns trigger
language plpgsql
as $$
declare
  v_region_id uuid;
  v_allows_dual_entry boolean;
begin
  if new.status = 'cancelled' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'cancelled' then
    return new;
  end if;

  select t.region_id, r.allows_dual_entry
    into v_region_id, v_allows_dual_entry
    from tournaments t
    join regions r on r.id = t.region_id
    where t.id = new.tournament_id;
  if v_allows_dual_entry then
    return new;
  end if;

  perform 1 from participants where id = new.participant_id for update;

  -- Every status but `cancelled` occupies the region, and this row's own
  -- tournament is excluded so re-entering it after cancelling still goes
  -- through -- the same rule `createEntry()` applies, kept in step with it.
  if exists (
    select 1
      from entries e
      join tournaments t on t.id = e.tournament_id
      where e.participant_id = new.participant_id
        and t.region_id = v_region_id
        and e.tournament_id <> new.tournament_id
        and e.status <> 'cancelled'
  ) then
    raise exception 'already entered another tournament in this region'
      using errcode = 'P0005';
  end if;

  return new;
end;
$$;

create trigger entries_check_region_dual_entry
  before insert or update on entries
  for each row
  execute function check_region_dual_entry();
