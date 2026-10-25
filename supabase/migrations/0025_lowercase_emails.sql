-- メールアドレスを小文字に揃え、以後も小文字以外を書けなくする(#133)。
--
-- `participants.email` / `staff_accounts.email` は `text` の unique で、比較も
-- 一意制約も大文字小文字を区別する。一方メールアドレスは実運用上大文字小文字を
-- 区別しないので、`Foo@example.com` と `foo@example.com` は同じ受信箱なのに
-- 別アカウントとして扱われていた。エントリーでは既存参加者のパスワード確認・
-- 地域重複・二重エントリーの検査をすべて素通りして参加者行が増え、ログインでは
-- 該当行が無くパスワード誤りと同じ 401 になる。
--
-- アプリ側は `packages/shared/src/schemas/email.ts` の `emailAddressSchema()` が
-- 入力を小文字にする。ここでは既存行を同じ形に直し、`email = lower(email)` の
-- check 制約を足す。この制約がある限り既存の unique 制約はそのまま大文字小文字を
-- 区別しない一意性になり、小文字化を通らない書き込み(SQL Editor から直接、など)は
-- 黙って二つ目の表記を作る代わりに失敗する。
--
-- 既に大文字小文字違いで複数行あると、小文字化は unique 制約で失敗する。どの行を
-- 残してエントリーをどちらに寄せるかは機械的に決められないので、その場合は衝突
-- しているアドレスを並べて止める。統合してから流し直すこと(統合の手順は
-- `docs/database-schema.md` の participants / staff_accounts の節)。
--
-- `staff_accounts` は 0026 で一意性が (email, tournament_type) に変わるが、
-- この時点ではまだ email だけで一意なので、email だけで衝突を見る。

do $$
declare
  v_conflicts text;
begin
  select string_agg(lower_email, ', ' order by lower_email)
    into v_conflicts
    from (
      select lower(email) as lower_email
        from participants
        group by lower(email)
        having count(*) > 1
    ) c;
  if v_conflicts is not null then
    raise exception 'participants differing only in email case: %',
      v_conflicts;
  end if;

  select string_agg(lower_email, ', ' order by lower_email)
    into v_conflicts
    from (
      select lower(email) as lower_email
        from staff_accounts
        group by lower(email)
        having count(*) > 1
    ) c;
  if v_conflicts is not null then
    raise exception 'staff accounts differing only in email case: %',
      v_conflicts;
  end if;
end;
$$;

update participants set email = lower(email) where email <> lower(email);
update staff_accounts set email = lower(email) where email <> lower(email);

alter table participants
  add constraint participants_email_lowercase check (email = lower(email));
alter table staff_accounts
  add constraint staff_accounts_email_lowercase check (email = lower(email));
