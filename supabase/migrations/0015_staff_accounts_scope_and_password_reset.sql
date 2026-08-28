-- Makes staff accounts issuable from the app: constrains the role/scope pair
-- that `POST /api/staff/accounts` writes, and adds the token table and
-- consuming function behind the invite mail that lets the new staff member
-- set their own password.

-- `regional` staff cover exactly one "region × tournament type" pair;
-- `general` staff cover everything and are scoped to neither. A row with only
-- one of the two columns filled in is not a lesser scope but a broken one:
-- `middleware/staff-auth.ts` compares both against the tournament, so such an
-- account is refused on every tournament in the system and does so with a
-- plain 403 that looks like an ordinary permission decision.
--
-- Rows in this shape are already unusable, so the constraint is added without
-- `not valid`: if one exists anywhere, the migration should fail loudly here
-- rather than let a silently-403ing account keep hiding in the table.
alter table staff_accounts
  add constraint staff_accounts_scope_matches_role
  check (
    (role = 'regional' and region_id is not null and tournament_type is not null)
    or (role = 'general' and region_id is null and tournament_type is null)
  );

-- Staff get their own reset token table rather than a share of
-- `password_reset_tokens`. That one's `participant_id` is a not-null foreign
-- key, so making it carry staff rows too would mean two nullable owner
-- columns of which exactly one is set on every row -- an invariant nothing
-- but application code could enforce.
create table staff_password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  staff_account_id uuid not null references staff_accounts (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- Same reason as `0012` on the participant table: both statements that
-- address one account's links -- the burn inside `reset_staff_password()` and
-- the delete that `lib/staff-password-reset.ts` clears an account's
-- outstanding links with before issuing a new one -- filter on this column,
-- and the table otherwise carries only its primary key and the `token_hash`
-- unique index.
create index staff_password_reset_tokens_staff_account_id_idx
  on staff_password_reset_tokens (staff_account_id);

-- `0001`'s blanket RLS and grants covered `all tables in schema public` as
-- that schema stood then, so a table added later has to repeat them. Supabase
-- ships default privileges that hand a new public table to `anon` and
-- `authenticated` as well, which is exactly what `0001` revoked.
alter table staff_password_reset_tokens enable row level security;
revoke all on staff_password_reset_tokens from anon, authenticated;
grant select, insert, update, delete on staff_password_reset_tokens to service_role;

-- Consumes a staff reset token, sets the new password, and burns every other
-- link outstanding for the same account, all in one transaction.
--
-- This mirrors `reset_participant_password()` (see
-- `0011_participants_password_changed_at.sql`), including the locking order:
-- the staff row is locked *before* any token row is read for update, so two
-- links for the same account clicked at the same time queue up behind the
-- staff row instead of deadlocking on each other's token rows. The second one
-- then re-reads its token, finds `used_at` already set, and is refused.
--
-- There is no `password_changed_at` counterpart to stamp here. Staff sessions
-- are 12-hour JWTs checked on their signature alone
-- (`middleware/staff-auth.ts`), so cutting the sessions that predate a reset
-- needs a column and a claim that don't exist yet; that is Task 11-3's job,
-- and it will redefine this function the way `0011` redefined `0010`.
--
-- Raises SQLSTATE `P0003` when the token is unknown, already used, or
-- expired. The caller maps all three onto the same 400 so they can't be told
-- apart.
create or replace function reset_staff_password(
  p_token_hash text,
  p_password_hash text
)
returns void
language plpgsql
as $$
declare
  v_staff_account_id uuid;
  v_expires_at timestamptz;
  v_used_at timestamptz;
begin
  select sprt.staff_account_id
    into v_staff_account_id
    from staff_password_reset_tokens sprt
    where sprt.token_hash = p_token_hash;

  if v_staff_account_id is null then
    raise exception 'invalid or expired token' using errcode = 'P0003';
  end if;

  -- Every reset for this account queues up here, whichever of their links it
  -- was started from, and this lock is always taken before any token row.
  perform 1 from staff_accounts sa where sa.id = v_staff_account_id for update;

  select sprt.staff_account_id, sprt.expires_at, sprt.used_at
    into v_staff_account_id, v_expires_at, v_used_at
    from staff_password_reset_tokens sprt
    where sprt.token_hash = p_token_hash
    for update;

  if v_staff_account_id is null or v_used_at is not null
    or v_expires_at < now() then
    raise exception 'invalid or expired token' using errcode = 'P0003';
  end if;

  update staff_accounts
    set password_hash = p_password_hash
    where id = v_staff_account_id;

  -- Covers the token being consumed here as well as any older link issued
  -- for the same account -- an invite that was re-sent, say -- so that a
  -- successful reset leaves nothing else outstanding.
  update staff_password_reset_tokens
    set used_at = now()
    where staff_account_id = v_staff_account_id and used_at is null;
end;
$$;

revoke all on function reset_staff_password(text, text) from public;
grant execute on function reset_staff_password(text, text) to service_role;
