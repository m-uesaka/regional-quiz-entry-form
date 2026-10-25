-- スタッフアカウントの有効化とパスワード設定リンクの発行を、無効化と同じく
-- アカウント行のロック下で行う(#156 の PR #167 のレビュー指摘)。
--
-- 0026 の時点では、有効化は API からの 2 回の呼び出し(`disabled_at` の更新と
-- リンクの削除)で、リンクの発行も「無効でないか読む → 古いリンクを消す →
-- 新しいリンクを入れる」をロック無しで行っていた。このため
-- - 有効化の更新だけが通ってリンクの削除が失敗すると、API は 500 を返すのに
--   アカウントは有効になり、無効化と競合して書かれた古いリンクが使えるように
--   なる
-- - 無効化の直前に無効でないことを読んだ再送が、無効化(と有効化)の後に
--   リンクを書き込める
-- - 既に有効なアカウントに古い画面から「有効化」を押すと、別の統括スタッフが
--   送ったばかりのリンクが黙って消える
-- ことがあった。いずれも、アカウント行をロックしてから状態を読み直し、
-- 書き込みまでを 1 トランザクションで行うことで防ぐ。ロックはどれも
-- アカウント行 → トークン行の順で、`reset_staff_password()` と同じ。

-- 1. 無効化(0026 の再定義)
--
-- 0026 は対象が地域スタッフでも既に無効でも、毎回すべての統括スタッフの行を
-- ロックしていた。統括スタッフの人数を数える必要があるのは、対象が有効な
-- 統括スタッフのときだけなので、それ以外は対象の行だけをロックする。
--
-- 対象の行を先にロックしてから残りの統括スタッフをロックすると、2 人の
-- 統括スタッフが互いを同時に無効化したときに、それぞれが自分の対象を持った
-- まま相手の対象を待ってデッドロックする。そこで役割だけをロック無しで先に
-- 読み、統括スタッフなら(対象を含む)全員を id 順にロックする。役割を変える
-- 経路は無いので、ロック無しで読んだ役割が後で変わることはない。
-- `disabled_at` はロックを取ってから読み直す。
create or replace function disable_staff_account(p_staff_account_id uuid)
returns void
language plpgsql
as $$
declare
  v_role staff_role;
  v_disabled_at timestamptz;
begin
  select sa.role into v_role
    from staff_accounts sa
    where sa.id = p_staff_account_id;

  if not found then
    raise exception 'staff account % not found', p_staff_account_id
      using errcode = 'P0002';
  end if;

  if v_role = 'general' then
    perform 1 from staff_accounts sa
      where sa.role = 'general'
      order by sa.id
      for update;
  else
    perform 1 from staff_accounts sa
      where sa.id = p_staff_account_id
      for update;
  end if;

  select sa.disabled_at into v_disabled_at
    from staff_accounts sa
    where sa.id = p_staff_account_id;

  if v_disabled_at is not null then
    return;
  end if;

  if v_role = 'general' and not exists (
    select 1 from staff_accounts sa
      where sa.role = 'general'
        and sa.disabled_at is null
        and sa.id <> p_staff_account_id
  ) then
    raise exception 'cannot disable the last general staff account'
      using errcode = 'P0004';
  end if;

  update staff_accounts
    set disabled_at = now(),
        sessions_valid_from = now()
    where id = p_staff_account_id;

  delete from staff_password_reset_tokens
    where staff_account_id = p_staff_account_id;
end;
$$;

revoke all on function disable_staff_account(uuid) from public;
grant execute on function disable_staff_account(uuid) to service_role;

-- 2. 有効化
--
-- 無効なアカウントだけを有効に戻し、そのとき残っているリンクを消す。
-- 既に有効なアカウントには何もしない(リンクも消さない)。古い画面から
-- 押された「有効化」が、有効なアカウントに送られたばかりのリンクを消さない
-- ようにするため。
--
-- SQLSTATE: `P0002` はアカウントが無い。
create function enable_staff_account(p_staff_account_id uuid)
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

  if v_disabled_at is null then
    return;
  end if;

  update staff_accounts
    set disabled_at = null
    where id = p_staff_account_id;

  delete from staff_password_reset_tokens
    where staff_account_id = p_staff_account_id;
end;
$$;

revoke all on function enable_staff_account(uuid) from public;
grant execute on function enable_staff_account(uuid) to service_role;

-- 3. パスワード設定リンクの発行
--
-- `lib/staff-password-reset.ts` の `sendStaffPasswordLink()` が、古いリンクの
-- 削除と新しいリンクの追加をこの関数 1 回で行う。アカウント行をロックしてから
-- 無効でないかを見るので、無効化・有効化と同時に走っても、無効なアカウントに
-- 使えるリンクが残ることはない。リンクが書かれるのは、書き込みの時点で有効な
-- アカウントに対してだけになる。
--
-- 古いリンクを消してから入れる理由は 0015 当時の API と同じ(誤ったアドレスに
-- 送った招待を、新しいリンクの発行で使えなくするため)。
--
-- SQLSTATE: `P0002` はアカウントが無い、`P0005` はアカウントが無効。
create function issue_staff_password_link(
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
    where staff_account_id = p_staff_account_id;

  insert into staff_password_reset_tokens
    (staff_account_id, token_hash, expires_at)
    values (p_staff_account_id, p_token_hash, p_expires_at);
end;
$$;

revoke all on function issue_staff_password_link(uuid, text, timestamptz)
  from public;
grant execute on function issue_staff_password_link(uuid, text, timestamptz)
  to service_role;
