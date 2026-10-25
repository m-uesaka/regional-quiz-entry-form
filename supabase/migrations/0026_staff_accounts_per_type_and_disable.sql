-- スタッフアカウントを (メールアドレス, 種別) で区別できるようにし(#166)、
-- 統括スタッフがアカウントを無効化できるようにする(#156)。

-- 1. 同じメールアドレスで最強位・新人王の別アカウントを持てるようにする(#166)
--
-- 同じ地域の最強位と新人王を同じ人(同じ受信箱)が担当することがあり、
-- `email` だけの一意制約では 2 つ目のアカウントを作れなかった。一意性を
-- (email, tournament_type) に変え、ログインでは種別(統括スタッフは `general`)も
-- 選ばせて 1 行に絞る(`routes/staff-auth.ts`)。
--
-- 統括スタッフは `tournament_type` が null(0015 の check 制約)なので、
-- `nulls not distinct` にしないと統括スタッフ同士で同じアドレスが何行でも
-- 作れてしまう。これで統括スタッフはアドレスごとに 1 行、地域スタッフは
-- アドレス × 種別ごとに 1 行になる。統括スタッフと地域スタッフで同じアドレスを
-- 使うことも妨げないが、ログイン時の区分が違うので取り違えはしない。
alter table staff_accounts drop constraint staff_accounts_email_key;
alter table staff_accounts
  add constraint staff_accounts_email_tournament_type_key
  unique nulls not distinct (email, tournament_type);

-- 2. アカウントの無効化(#156)
--
-- セッションの無効化(`revoke-sessions`、0020)はパスワードを変えないので、
-- パスワードを知っている人はすぐ再ログインできる。退任したスタッフや、パスワード
-- ごと漏れたかもしれないケースを締め出すため、アカウント自体を無効にできるように
-- する。
--
-- 削除ではなく無効化にしている。`entries` など既存データからスタッフを参照する
-- 外部キーは無いので削除もできるが、消すと誰が担当していたかの記録も消え、
-- 誤操作を戻せない。無効化なら行もパスワードも残るので、有効化すれば元どおり
-- 使える。
--
-- null が有効、値があればその時刻に無効化された。無効なアカウントは
-- - ログインできない(`routes/staff-auth.ts` が無効な行を探さない)
-- - 発行済みのセッションも通らない(無効化と同時に `sessions_valid_from` を
--   進めるうえ、`middleware/staff-auth.ts` もこの列を見る)
-- - パスワード設定リンクを発行できず、発行済みのリンクも使えない
--   (`reset_staff_password()` が拒否する)
alter table staff_accounts add column disabled_at timestamptz;

-- アカウントを無効化する。既存のセッションを切り、未使用のパスワード設定リンクも
-- 消す。
--
-- 統括スタッフが 0 人になる無効化は拒否する。API は自分自身の無効化を先に
-- 断るが、それだけでは 2 人の統括スタッフが同時に互いを無効化すると 0 人になる。
-- 統括スタッフの行を id 順にすべてロックしてから数えるので、同時に来た無効化は
-- ここで順番待ちになり、後の方は先の方の結果を見て断られる。スタッフ行を
-- トークン行より先にロックする順序は `reset_staff_password()` と同じ。
--
-- 既に無効なアカウントには何もしない(`disabled_at` も最初の時刻のまま)。
--
-- SQLSTATE: `P0002` はアカウントが無い、`P0004` は有効な統括スタッフが
-- 残らなくなる。
create function disable_staff_account(p_staff_account_id uuid)
returns void
language plpgsql
as $$
declare
  v_role staff_role;
  v_disabled_at timestamptz;
begin
  perform 1 from staff_accounts sa
    where sa.role = 'general'
    order by sa.id
    for update;

  select sa.role, sa.disabled_at
    into v_role, v_disabled_at
    from staff_accounts sa
    where sa.id = p_staff_account_id
    for update;

  if not found then
    raise exception 'staff account % not found', p_staff_account_id
      using errcode = 'P0002';
  end if;

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

-- `0020` の `reset_staff_password()` を、無効なアカウントのリンクを拒否するように
-- 再定義する。無効化の時点でリンクは消しているが、無効化と同時に確認が走った
-- 場合や、無効なままのアカウントに SQL で直接リンクを足した場合にも、
-- パスワードを設定させない。判定はアカウント行のロックを取ったあとの読み取りで
-- 行うので、無効化との競合でもどちらかが待つ。
--
-- 拒否は既存と同じ `P0003`(リンクが無効か期限切れ)にする。リンクを持つ人に
-- 「アカウントが無効化されている」ことを知らせる必要は無い。
--
-- ロックの順序・それ以外の動作は `0020` のまま。
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
  v_disabled_at timestamptz;
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
  select sa.disabled_at
    into v_disabled_at
    from staff_accounts sa
    where sa.id = v_staff_account_id
    for update;

  if v_disabled_at is not null then
    raise exception 'invalid or expired token' using errcode = 'P0003';
  end if;

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
