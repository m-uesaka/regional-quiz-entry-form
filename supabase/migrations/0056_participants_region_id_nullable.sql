-- `participants.region_id` の廃止の 1 段階目(#309): 列を nullable にし、
-- 書き込むのをやめる。
--
-- この列は 0043 以降どの判定にも使われておらず(地域をまたいだ参加はトリガ
-- `check_entry_seat()` がエントリーそのものを見て断る)、アプリケーションも
-- SQL も読んでいない。#308 でエントリーのたびに移すこともやめたので、残って
-- いる書き込みは参加者の INSERT と `take_over_unverified_participant()` だけ
-- だった。このマイグレーションと同じリリースの Worker は、そのどちらでも
-- 列に触れない。
--
-- 2 段階に分けるのは、マイグレーションが Worker より先に走り、デプロイ中の
-- 古い Worker がしばらく並行して動くため。
--
-- - 古い Worker は INSERT に `region_id` を付け、
--   `take_over_unverified_participant()` を `p_region_id` 付きで呼び、
--   `claim_participant_region_for_tournament()` も呼ぶ。どれもこの
--   マイグレーションの後も通る。
-- - 新しい Worker は INSERT に `region_id` を付けないので、列が nullable で
--   ないと参加者を作れない。
--
-- 列、インデックス `participants_region_id_idx`(0022)、外部キー、
-- `take_over_unverified_participant()` の `p_region_id`、
-- `claim_participant_region_for_tournament()` は、古い Worker がいなくなった
-- 後の 2 段階目のマイグレーションで消す。既存の行の値もそれまで触らない
-- (どこからも読まれないので、null に揃える意味がない)。
alter table participants alter column region_id drop not null;

comment on column participants.region_id is
  '廃止予定(#309)。どこからも読まれず、新しい行では null。列は次の段階のマイグレーションで削除する';

-- 0034 の定義から、`region_id` の上書きだけを外したもの。他は変えていない。
--
-- `p_region_id` は受け取るだけで使わない。古い Worker は 3 つの引数で、新しい
-- Worker は 2 つの引数で呼ぶので、既定値を付けてどちらも同じ関数に解決される
-- ようにする(引数の違う関数をもう 1 つ作ると、PostgREST がどちらを呼ぶか
-- 決められないことがある)。引数の型は変わらないので `create or replace` で
-- 済み、0034 の `revoke` / `grant`(`service_role` のみ実行可)もそのまま残る。
create or replace function take_over_unverified_participant(
  p_participant_id uuid,
  p_password_hash text,
  p_region_id uuid default null
)
returns uuid[]
language plpgsql
as $$
declare
  v_withdrawn uuid[];
begin
  perform 1 from participants p
    where p.id = p_participant_id
      and p.email_verified_at is null
    for no key update;

  if not found then
    return null;
  end if;

  -- Belt and braces: an entry only ever gets `email_verified_at` from
  -- `confirm_entry_by_token()`, which verifies the participant in the same
  -- transaction, so this only matters for a row the 0034 backfill missed.
  -- A statement of its own rather than part of the locking query above: a
  -- query that had to wait for the lock re-checks only the locked row's own
  -- columns against what committed meanwhile (READ COMMITTED's
  -- EvalPlanQual), and would judge `entries` by the snapshot it started
  -- with. This statement starts after the lock is held and sees every
  -- confirmation committed before it.
  if exists (
    select 1 from entries e
      where e.participant_id = p_participant_id
        and e.email_verified_at is not null
  ) then
    return null;
  end if;

  update participants
    set password_hash = p_password_hash,
        password_changed_at = now()
    where id = p_participant_id;

  perform 1 from email_verification_tokens evt
    join entries e on e.id = evt.entry_id
    where e.participant_id = p_participant_id
    order by e.tournament_id, e.id, evt.id
    for update of evt;

  -- Read after the token locks, so an entry a concurrent lapse or
  -- cancellation moved out of `pending_verification` meanwhile is not
  -- reported as withdrawn by this call.
  v_withdrawn := array(
    select e.tournament_id from entries e
      where e.participant_id = p_participant_id
        and e.status = 'pending_verification'
      order by e.tournament_id
  );

  delete from email_verification_tokens evt
    using entries e
    where e.id = evt.entry_id and e.participant_id = p_participant_id;

  -- `entry_regulations` goes with each row (`on delete cascade`, 0018).
  delete from entries e where e.participant_id = p_participant_id;

  return v_withdrawn;
end;
$$;

-- `claim_participant_region_for_tournament()`(0043)は触らない。`region_id` が
-- null の参加者では、地域を移す UPDATE の `p.region_id <> t.region_id` が null に
-- なって 1 行も更新しないだけで、判定(`participant_holds_conflicting_region()`)
-- と戻り値は変わらない。

-- 引数に既定値が付いたことを PostgREST に伝える(2 つの引数での呼び出しは、
-- スキーマキャッシュが古いと解決されない)。
notify pgrst, 'reload schema';
