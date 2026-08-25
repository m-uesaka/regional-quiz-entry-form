-- Records when each participant's password last changed, and stamps it as
-- part of `reset_participant_password`.
--
-- Participant sessions are stateless HS256 JWTs with a 7-day TTL, accepted on
-- their signature and `exp` alone (`middleware/participant-auth.ts`), and a
-- reset touched nothing any already-issued cookie depends on. Someone holding
-- a stolen `participant_session` cookie therefore kept full access to
-- `/api/mypage` for up to a week after the participant reset their password
-- to lock them out -- the one thing a password reset is expected to
-- accomplish.
--
-- With this column, each session can carry the value that was current when it
-- was issued and be refused once the column moves, so every cookie handed out
-- before a reset stops being accepted. It is stamped by the same function, and
-- therefore inside the same transaction, as the password update itself: a
-- reset can never take effect without also cutting the sessions that predate
-- it.
--
-- `default now()` backfills existing rows with the migration time, which
-- invalidates participant sessions issued before it -- those participants log
-- in once more. There is no correct earlier value to backfill, and the
-- sessions are short-lived either way.
alter table participants
  add column password_changed_at timestamptz not null default now();

-- Redefined here rather than edited in
-- `0010_reset_participant_password_participant_lock`, which is already
-- applied everywhere: `supabase db push` runs a version once and never
-- re-runs it, so an in-place edit would leave the stamping out of every
-- environment except a freshly reset one. The locking order below is
-- unchanged from `0010`; see that file for why it is what it is.
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

  -- `password_changed_at` moves with the password in one statement, so no
  -- window exists where the new password is live but the old sessions are
  -- still honoured.
  update participants
    set password_hash = p_password_hash,
        password_changed_at = now()
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
