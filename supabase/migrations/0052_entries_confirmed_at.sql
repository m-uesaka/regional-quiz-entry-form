-- 受付終了後に取り消したキャンセル待ちが、確定済みだったとして地域を押さえ
-- 続けないようにする(#287)。
--
-- 0040 の意図は「その大会の受付終了より後にキャンセルした、確定済みだった
-- エントリー」だけが地域を押さえること(キャンセルに期限が無いので、出場した後に
-- 取り消して別の地域に出るのを防ぐ)。しかし判定
-- (`participant_holds_conflicting_region()`、0046)は `email_verified_at is not
-- null` で「確定済みだった」を見ていた。`email_verified_at` はキャンセル待ちに
-- なったときにも入る(0034)ので、一度も席を得ないまま受付終了後にキャンセル
-- 待ちを取り消した人も、同じ問題セットの別の地域の大会に断られていた。
--
-- `entries.confirmed_at`(最後に `confirmed` になった時刻)を足し、判定を
-- この列で行う。
--
-- 列は BEFORE トリガ(`entries_set_confirmed_at`)で入れる。`confirmed` に
-- なる書き込み(INSERT、または `confirmed` 以外からの UPDATE)で `now()` を
-- 入れる。確認リンク(`confirm_entry_by_token()`)と繰り上げ
-- (`promote_waitlisted_entries()`)のどちらも `confirmed` にする UPDATE なので
-- 関数を変えずに済み、デプロイ中の古い Worker や、運用で直接 SQL を流して
-- 確定にした行にも入る。トリガはロックを取らず、NEW の列を埋めるだけなので、
-- 0041 のロック順には影響しない。
-- `check (status <> 'confirmed' or confirmed_at is not null)` で、確定済みの行に
-- 時刻が無い状態を断る。
--
-- 再エントリー(`reenter_cancelled_entry()`、0041)は `email_verified_at` と
-- 同じく `confirmed_at` を null に戻す。前のエントリーで確定したことは、新しい
-- エントリーが確定したことにはならないため。再エントリーが途中で失敗したときに
-- 行を元に戻す Worker 側の処理(`rollbackEntry()`)は、新しい Worker から
-- `confirmed_at` も戻す。デプロイ中の古い Worker が戻すと `confirmed_at` が
-- null のまま残り、その行は地域を押さえなくなる(再エントリーの失敗と入れ替えの
-- 間の重なりに限られ、断られるべき別地域のエントリーが通る向きにしか崩れない)。
--
-- 既存の行の埋め方:
--   - `confirmed` の行: `email_verified_at`(無ければ `created_at`)。繰り上げで
--     確定した行の本当の時刻は残っていないので、確定しうる最も早い時刻で
--     代える。判定に使うのは null かどうかだけ
--   - 受付終了後に取り消され、`email_verified_at` のある行: 確定済みだったか
--     キャンセル待ちだったかは今の列では区別できない。これまでどおり地域を
--     押さえる側(確定済みだった)に倒し、`email_verified_at` で埋める。
--     キャンセル待ちだった行を確定済みとみなす誤りは、これまでと同じく別地域の
--     エントリーを断るだけで、地域をまたいだ参加を許すことはない。逆に倒すと、
--     出場した後に取り消した人が別の地域に出られてしまう
--   - その他の行(確定待ち・キャンセル待ち・受付中に取り消した行など): null。
--     受付中に取り消した行は確定済みだったとしても地域を押さえないので、
--     埋めなくても判定は変わらない
--
-- 判定の置き換えは `participant_holds_conflicting_region()`(0046 の本体の
-- 条件を 1 つ置き換えただけ。シグネチャは変えない)で行う。断る範囲が狭まる
-- だけ(既存の行はこれまでと同じ判定になる)なので、古い Worker との組み合わせ
-- でも検査のない隙間はできない。0040 の `claim_participant_region()` も同じ
-- 条件を持つが、どの Worker からも呼ばれておらず削除予定なので触らない。

alter table entries add column confirmed_at timestamptz;

update entries
  set confirmed_at = coalesce(email_verified_at, created_at)
  where status = 'confirmed';

update entries e
  set confirmed_at = e.email_verified_at
  from tournaments t
  where t.id = e.tournament_id
    and e.status = 'cancelled'
    and e.email_verified_at is not null
    and e.cancelled_at > t.entry_closes_at;

alter table entries
  add constraint entries_confirmed_has_confirmed_at
    check (status <> 'confirmed' or confirmed_at is not null);

create function set_entry_confirmed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'confirmed' then
    if tg_op = 'INSERT' then
      new.confirmed_at := coalesce(new.confirmed_at, now());
    elsif old.status <> 'confirmed' then
      new.confirmed_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger entries_set_confirmed_at
  before insert or update of status on entries
  for each row
  execute function set_entry_confirmed_at();

create or replace function participant_holds_conflicting_region(
  p_participant_id uuid,
  p_tournament_id uuid
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from tournaments target
      join entries e on e.participant_id = p_participant_id
      join tournaments t on t.id = e.tournament_id
      where target.id = p_tournament_id
        and t.region_id <> target.region_id
        and same_question_set(
          t.question_set, t.type, target.question_set, target.type
        )
        and (
          e.status <> 'cancelled'
          or (
            e.confirmed_at is not null
            and e.cancelled_at > t.entry_closes_at
          )
        )
  );
$$;

create or replace function reenter_cancelled_entry(
  p_entry_id uuid,
  p_participant_id uuid,
  p_name text,
  p_furigana text,
  p_display_name text,
  p_free_text text,
  p_custom_field_values jsonb
)
returns setof entries
language plpgsql
as $$
begin
  perform 1 from participants p
    where p.id = p_participant_id
    for no key update;

  delete from email_verification_tokens t
    using entries e
    where t.entry_id = p_entry_id
      and e.id = t.entry_id
      and e.participant_id = p_participant_id
      and e.status = 'cancelled'
      and (t.used_at is not null or t.expires_at < now());

  return query
    update entries e
      set name = p_name,
          furigana = p_furigana,
          display_name = p_display_name,
          free_text = p_free_text,
          custom_field_values = p_custom_field_values,
          status = 'pending_verification',
          waitlist_position = null,
          email_verified_at = null,
          confirmed_at = null,
          cancelled_at = null
      where e.id = p_entry_id
        and e.participant_id = p_participant_id
        and e.status = 'cancelled'
      returning e.*;
end;
$$;

-- `setof entries` の形が列の追加で変わったので、PostgREST にスキーマを読み
-- 直させる。
notify pgrst, 'reload schema';
