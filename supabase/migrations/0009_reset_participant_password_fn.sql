-- Atomically consumes a password reset token, sets the new password, and
-- burns every other reset token still outstanding for the same participant.
--
-- The PL/pgSQL body runs inside the calling statement's single implicit
-- transaction, so the password update and the burning of the remaining
-- tokens either both commit or both roll back. Doing this as separate
-- statements from the API meant a failure of the second one left the new
-- password in place while older reset links stayed usable, silently
-- weakening the "one successful reset invalidates every outstanding link"
-- guarantee; now such a failure rolls the whole reset back and the
-- participant is told to try again.
--
-- `for update` locks the token row for the duration, so a second call that
-- replays the same token blocks until the first commits and then observes
-- `used_at` already set instead of both calls resetting the password.
--
-- Raises SQLSTATE `P0003` when the token is unknown, already used, or
-- expired, which the caller maps to the same 400 response for all three so
-- the three cases can't be told apart.
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
