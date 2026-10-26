-- スタッフ本人がパスワード再設定を申し込んだとき(#175)のリンクを、
-- アカウントの他のリンクを消さずに書き足す `add_staff_password_link()`。
--
-- 統括スタッフが発行するリンク(`issue_staff_password_link()`、0027)は、
-- 書き込む前にそのアカウントのリンクをすべて消す。誤ったアドレスに送った
-- 招待を送り直したとき、古いリンクを確実に使えなくするためである。
-- 一方、本人の申し込みは未認証の `POST /api/auth/staff/password-reset/request`
-- から誰でも行えるので、同じように消すと、アドレスと区分を知っている人が
-- 申し込みを繰り返すだけで、統括スタッフが送ったばかりの 24 時間の招待を
-- 1 時間のリンクに置き換え続けられてしまう。
--
-- そこで本人の申し込みでは、有効なリンクには触らずに新しいリンクを足す。
-- どのリンクを使っても、パスワードを設定した時点で `reset_staff_password()`
-- (0026)が残りをすべて使用済みにするので、古いリンクが後から使われることは
-- ない。申し込みは未認証で 1 回ごとに 1 行増えるため、そのアカウントの
-- 期限切れのリンクはここで消す(参加者の `requestPasswordReset()` と同じ)。
--
-- アカウント行をロックしてから無効かどうかを読み、無効なら書かずに断る
-- (`issue_staff_password_link()` と同じ SQLSTATE `P0005`)。ロックの順は
-- アカウント行 → トークン行で、`reset_staff_password()` と同じ。
create function add_staff_password_link(
  p_staff_account_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns void
language plpgsql
as $$
declare
  v_disabled_at timestamptz;
begin
  select sa.disabled_at into v_disabled_at
    from staff_accounts sa
    where sa.id = p_staff_account_id
    for update;

  if not found then
    raise exception 'staff account % not found', p_staff_account_id
      using errcode = 'P0002';
  end if;

  if v_disabled_at is not null then
    raise exception 'staff account % is disabled', p_staff_account_id
      using errcode = 'P0005';
  end if;

  delete from staff_password_reset_tokens
    where staff_account_id = p_staff_account_id
      and expires_at < now();

  insert into staff_password_reset_tokens
    (staff_account_id, token_hash, expires_at)
    values (p_staff_account_id, p_token_hash, p_expires_at);
end;
$$;

revoke all on function add_staff_password_link(uuid, text, timestamptz)
  from public;
grant execute on function add_staff_password_link(uuid, text, timestamptz)
  to service_role;
