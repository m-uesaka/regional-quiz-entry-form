-- 使う問題が違う大会どうしなら、地域をまたいでエントリーできるようにする。
--
-- 地域をまたいで参加できないのは、どの地域も共通の問題を使うからだった。
-- 本番では宮崎と鹿児島がそれぞれ別の問題を使うので、両方に出ても問題が
-- 漏れることはなく、実際に相互にエントリーできていた。使う問題は地域・大会
-- ごとに決まるので、大会に `question_set`(問題セットの名前)を持たせ、
-- 地域をまたいで断るのは同じ問題セットの大会どうしだけにする。
--
-- `null` は共通問題を表す。既存の大会はすべて `null` のままなので、この
-- マイグレーションだけでは挙動は変わらない(どの 2 地域の大会も同じ問題
-- セットとして断られる)。独自の問題を使う大会には、統括スタッフが名前を
-- 設定する(例: `宮崎`)。名前が同じ大会どうしは同じ問題を使うものとして
-- 扱う。設定を変えても、既に受け付けたエントリーは検査し直さない(別の
-- 問題セットだった 2 大会を同じにしても、両方のエントリーはそのまま残る)。同じ地域の最強位・新人王の組は今までどおり `regions.allows_dual_entry`
-- だけで決まり、問題セットは見ない。
--
-- 何が地域を押さえるかは 0040 と同じ(参加中のエントリーと、受付終了より後に
-- キャンセルした確定済みのエントリー)。それを、問題セットが同じ別の地域の
-- 大会に限る。判定は `participant_holds_conflicting_region()` の 1 か所に置き、
-- トリガ `check_entry_seat()`、新しい `claim_participant_region_for_tournament()`、
-- アプリケーションの未確認アカウントの判定(`createEntryAfterCheck()`)が
-- これを呼ぶ。
--
-- `participants.region_id` は残すが、もう判定には使わない。複数の地域に
-- 参加中の参加者がいるので「参加者の地域」は 1 つに決まらず、トリガは
-- 参加者の地域との一致(`P0008`)ではなくエントリーそのものを見る。参加者行の
-- ロックの下で見るので、0040 の「移す → 書く」の間に別の送信が割り込んでも
-- 地域をまたいだ 2 枠は残らない。断るときの errcode は `P0008` のまま。
--
-- デプロイの順序: マイグレーションは Worker より先に走る。古い Worker は
-- `claim_participant_region()`(地域だけを見る厳しい判定)を呼び続けるので、
-- その間は今までどおり断られるだけで、検査のない隙間はできない。新しい
-- Worker は `claim_participant_region_for_tournament()` を呼ぶ。古い関数は
-- 次のマイグレーションで消す。
alter table tournaments
  add column question_set text,
  -- 名前が 1 文字でも違えば別の問題セットになり、断るべきエントリーが
  -- 通ってしまう(誤りが緩い側に倒れる)。見分けにくい違いのうち機械的に
  -- 弾けるもの、つまり前後の空白(全角空白 U+3000 を含む)と途中の空白を
  -- 拒否する。異体字(「崎」と「﨑」など)は弾けないので、設定は既存の
  -- 名前を確かめてから行う。
  add constraint tournaments_question_set_format check (
    question_set is null
    or (
      char_length(question_set) between 1 and 100
      and question_set !~ '[[:space:]\u3000]'
    )
  );

comment on column tournaments.question_set is
  '使用する問題セットの名前。null は共通問題。同じ問題セットの大会どうしは地域をまたいでエントリーできない';

-- `p_participant_id` が、`p_tournament_id` とは別の地域で、同じ問題セットの
-- 大会の枠を押さえているか。ロックは取らない。呼び出し側が参加者行を取った
-- 後の別の文で呼べば、ロック待ちの間にコミットされたエントリーも見える
-- (STABLE の SQL 関数は呼び出した文のスナップショットで読む)。
create function participant_holds_conflicting_region(
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
        and t.question_set is not distinct from target.question_set
        and (
          e.status <> 'cancelled'
          or (
            e.email_verified_at is not null
            and e.cancelled_at > t.entry_closes_at
          )
        )
  );
$$;

revoke all on function participant_holds_conflicting_region(uuid, uuid)
  from public;
grant execute on function participant_holds_conflicting_region(uuid, uuid)
  to service_role;

-- 0040 の `claim_participant_region()` を大会単位にしたもの。断る条件が
-- 問題セットに依存するので、地域ではなく大会を受け取る。移せたら(もともと
-- その地域なら何もせずに)true、同じ問題セットの別の地域の枠があれば false。
-- `participants.region_id` は最後にエントリーした地域を記録するだけになる。
create function claim_participant_region_for_tournament(
  p_participant_id uuid,
  p_tournament_id uuid
)
returns boolean
language plpgsql
as $$
begin
  perform 1 from participants p
    where p.id = p_participant_id
    for no key update;

  if participant_holds_conflicting_region(p_participant_id, p_tournament_id)
  then
    return false;
  end if;

  update participants p
    set region_id = t.region_id
    from tournaments t
    where p.id = p_participant_id
      and t.id = p_tournament_id
      and p.region_id <> t.region_id;

  return true;
end;
$$;

revoke all on function claim_participant_region_for_tournament(uuid, uuid)
  from public;
grant execute on function claim_participant_region_for_tournament(uuid, uuid)
  to service_role;

-- 0041 の本体から、参加者の地域との一致の検査を、エントリーを見る検査に
-- 置き換えたもの。ロックの取り方、検査する書き込み、重複エントリーの検査は
-- 変えない。
create or replace function check_entry_seat()
returns trigger
language plpgsql
as $$
declare
  v_tournament_region_id uuid;
  v_allows_dual_entry boolean;
begin
  -- Only a write *taking* a seat is checked: see 0041.
  if new.status = 'cancelled' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'cancelled' then
    return new;
  end if;

  -- The participant is the contended resource: every check below runs under
  -- this lock, which is what serializes it with a concurrent submission's
  -- write and with `claim_participant_region_for_tournament()`.
  perform 1
    from participants p
    where p.id = new.participant_id
    for no key update;

  select t.region_id, r.allows_dual_entry
    into v_tournament_region_id, v_allows_dual_entry
    from tournaments t
    join regions r on r.id = t.region_id
    where t.id = new.tournament_id;

  -- A statement of its own after the lock, so it sees what a concurrent
  -- submission committed while this one waited.
  if participant_holds_conflicting_region(new.participant_id, new.tournament_id)
  then
    raise exception 'participant belongs to another region'
      using errcode = 'P0008';
  end if;

  if v_allows_dual_entry then
    return new;
  end if;

  if exists (
    select 1
      from entries e
      join tournaments t on t.id = e.tournament_id
      where e.participant_id = new.participant_id
        and t.region_id = v_tournament_region_id
        and e.tournament_id <> new.tournament_id
        and e.status <> 'cancelled'
  ) then
    raise exception 'already entered another tournament in this region'
      using errcode = 'P0005';
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
