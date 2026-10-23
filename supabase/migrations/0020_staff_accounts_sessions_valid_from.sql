-- 発行済みスタッフ JWT を無効化するための世代(Task 11-3)。
--
-- スタッフのセッションは stateless な JWT で 12 時間有効なので、これまでは
-- Cookie が漏れても期限切れまで止める手段が無かった。しかもスタッフの Cookie
-- は参加者全員の氏名・ふりがな・メールアドレスに届く。
--
-- ログイン時にこの値を JWT の `sessionsValidFrom` に埋め、
-- `middleware/staff-auth.ts` がリクエストごとに今の値と突き合わせる。
-- 値を進める(`POST /api/staff/accounts/:id/revoke-sessions`)と、それ以前に
-- 発行されたセッションはすべて一致しなくなって切れる。
--
-- 参加者側の `participants.password_changed_at`(`0011`)と同じ役割だが、
-- パスワード変更以外(退任・端末紛失)でも進められるようにこの名前にしている。
--
-- 既存行は `now()` で埋まる。適用前に発行されたセッションはこのクレームを
-- 持たないので、どのみち形の検証(`StaffClaimsSchema`)で弾かれて再ログインに
-- なる。
alter table staff_accounts
  add column sessions_valid_from timestamptz not null default now();

-- `0015` の `reset_staff_password()` を、パスワードの更新と同じ UPDATE 文で
-- `sessions_valid_from` も進めるように再定義する(`0011` が参加者側の
-- `0010` を再定義したのと同じ形)。
--
-- パスワードを再設定するのは「今のパスワードが漏れたかもしれない」ときなので、
-- それ以前に発行されたセッション(盗まれた Cookie を含む)もそこで切れなければ
-- 意味が薄い。統括スタッフの明示的な無効化を待たずに切れるようにしておく。
-- 招待リンクからの初回設定でもこの関数を通るが、その時点ではまだログインできて
-- いないので、切れるセッションは無い。
--
-- ロックの順序・エラーコードなど、それ以外は `0015` のまま。
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

  -- Moving `sessions_valid_from` in the same statement as the password is
  -- what ends every session issued before the reset: the staff guards
  -- compare each session's `sessionsValidFrom` claim against this column.
  update staff_accounts
    set password_hash = p_password_hash,
        sessions_valid_from = now()
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
