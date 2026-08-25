-- Serializes `reset_participant_password` on the participant row.
--
-- `0009` locked only the token row the caller presented. Two reset links
-- outstanding for the same participant are two different rows, so two
-- confirmations arriving together each locked their own token and neither
-- waited for the other. They then collided over rows they had not taken yet:
-- each one updates the shared `participants` row and burns *every*
-- outstanding token for that participant, so the first transaction ended up
-- waiting for the second one's token row while the second waited for the
-- first one's `participants` row -- a deadlock, which Postgres breaks by
-- aborting one of them with SQLSTATE `40P01`. The participant whose link was
-- picked as the victim got a 500 for a link that was perfectly valid.
--
-- The fix is to take a lock both callers are guaranteed to contend on, and
-- to take it before any token row: the `participants` row is locked first,
-- so a second confirmation for the same participant blocks there, before it
-- can hold anything the first one still needs. Once the first commits, the
-- second re-reads its own token under that lock, sees the `used_at` the
-- first one set, and is refused with `P0003` -- the same 400 a replayed
-- token already got, which is the intended outcome: one successful reset
-- invalidates every other link.
--
-- The participant is located by an unlocked read first, purely to learn
-- which row to lock; nothing is decided on it. The token is re-read under
-- the lock afterwards and only that second read is trusted, so a token
-- consumed or expired in between is still caught.
--
-- Redefined here rather than edited in `0009_reset_participant_password_fn`,
-- which is already applied everywhere: `supabase db push` runs a version
-- once and never re-runs it, so an in-place edit would leave this ordering
-- out of every environment except a freshly reset one. `0007` and `0008`
-- amend `0004` and `0003` the same way.
create or replace function reset_participant_password(
  p_token_hash text,
  p_password_hash text
)
returns void
language plpgsql
as $$
declare
  v_participant_id uuid;
  v_expires_at timestamptz;
  v_used_at timestamptz;
begin
  select prt.participant_id
    into v_participant_id
    from password_reset_tokens prt
    where prt.token_hash = p_token_hash;

  if v_participant_id is null then
    raise exception 'invalid or expired token' using errcode = 'P0003';
  end if;

  -- Every reset for this participant queues up here, whichever of their
  -- links it was started from, and this lock is always taken before any
  -- token row.
  perform 1 from participants p where p.id = v_participant_id for update;

  select prt.participant_id, prt.expires_at, prt.used_at
    into v_participant_id, v_expires_at, v_used_at
    from password_reset_tokens prt
    where prt.token_hash = p_token_hash
    for update;

  if v_participant_id is null or v_used_at is not null
    or v_expires_at < now() then
    raise exception 'invalid or expired token' using errcode = 'P0003';
  end if;

  update participants
    set password_hash = p_password_hash
    where id = v_participant_id;

  -- Covers the token being consumed here as well as any older link the
  -- participant requested before it.
  update password_reset_tokens
    set used_at = now()
    where participant_id = v_participant_id and used_at is null;
end;
$$;

revoke all on function reset_participant_password(text, text) from public;
grant execute on function reset_participant_password(text, text) to service_role;
