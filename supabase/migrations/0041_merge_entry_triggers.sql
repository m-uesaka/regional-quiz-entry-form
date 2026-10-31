-- エントリーの 2 つのトリガを 1 つにまとめ、参加者行のロックを揃える(#242)。
--
-- `check_region_dual_entry()`(0017)と `check_participant_region()`(0040)は、
-- 同じ条件で枠を取る書き込みだけを検査し、どちらも参加者行を `for update` で
-- 取っていた。これを `check_entry_seat()` にまとめる。検査の順は、これまで
-- トリガが発火していた順(名前順)のまま、地域の一致 → 重複エントリー。
-- `P0008` / `P0005` の errcode とメッセージは変えない。
--
-- 参加者行は `for no key update` で取る。`claim_participant_region()` や
-- `confirm_entry_by_token()`、`take_over_unverified_participant()` と同じ強さで、
-- これらとは今までどおり直列化され、外部キー検査の `for key share` とは
-- 衝突しない。
--
-- 再エントリーは `reenter_cancelled_entry()`(下記)に移す。テーブルへの直接の
-- UPDATE は、BEFORE ROW トリガが動く前に `entries` 行をロックするので、トリガの
-- 中で参加者行を取ると「`entries` 行 → 参加者行」になり、「参加者行 → `entries`
-- 行(の削除)」で取る `take_over_unverified_participant()` とデッドロックする
-- ことがあった。トリガの中では順序を変えられないので、UPDATE の前に参加者行を
-- 取る関数にする。
--
-- ロック順(P: 参加者行、Tk: トークン行、T: 大会行、E: `entries` 行)。
--
-- - エントリーの INSERT            P → T(外部キー検査の key share)
-- - `reenter_cancelled_entry()`    P → E
-- - `confirm_entry_by_token()`     P → Tk → T → E
-- - `take_over_unverified_participant()`  P → Tk → E
-- - `cancel_own_entry()`、`lapse_expired_pending_entries()`  Tk → T → E(P なし)
-- - `promote_waitlisted_entries()`  T → E(P なし)
--
-- 下の 3 つが P を取らずに済むのは、トリガが枠を取る書き込みしか検査しない
-- ため。これらは T を持ったまま、既に枠を持つ行のステータスを変える(行を
-- `cancelled` にする、繰り上げる、順位を詰める)。そこで P を取りに行くと、
-- P を持って T を待つ INSERT や確定と逆順になる。
--
-- 唯一の例外は `reset_tournament_entries()` の T → E → P(参加者も消すとき)。
-- 受付期間外にしか動かず(`P0007`)、INSERT や再エントリーは受付期間内にしか
-- 始まらないので、重なるのは受付終了の瞬間の行き違いに限られる。確定と上書きとの
-- 逆順は 0038 からのもの。この関数は変えない。
--
-- デプロイの順序: マイグレーションは Worker より先に走る。適用後もしばらくは
-- 古い Worker が `entries` を直接 UPDATE するので、トリガは再エントリーの検査と
-- 参加者行のロックをこれまでどおり行う(古い Worker の再エントリーに残る
-- デッドロックは Worker の入れ替えで消える)。トリガの交換は、新しいトリガを
-- 張ってから古いトリガを外す順にする。どの時点でも少なくとも 1 組の検査が
-- 効いていて、検査のない隙間ができない。
create function check_entry_seat()
returns trigger
language plpgsql
as $$
declare
  v_participant_region_id uuid;
  v_tournament_region_id uuid;
  v_allows_dual_entry boolean;
begin
  -- Only a write *taking* a seat is checked: an insert, or a re-entry updating
  -- the participant's own cancelled row. Every other status change passed
  -- when the seat was taken, and `cancel_own_entry()`,
  -- `lapse_expired_pending_entries()` and `promote_waitlisted_entries()` make
  -- them while holding the tournament lock without the participant lock:
  -- taking it here would invert the order an insert takes the two in.
  if new.status = 'cancelled' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'cancelled' then
    return new;
  end if;

  -- The participant is the contended resource, so locking it (rather than
  -- the region, which every entry in the region shares) keeps unrelated
  -- submissions from serializing behind each other. Reading the region under
  -- this lock is what serializes the check with
  -- `claim_participant_region()`.
  select p.region_id into v_participant_region_id
    from participants p
    where p.id = new.participant_id
    for no key update;

  select t.region_id, r.allows_dual_entry
    into v_tournament_region_id, v_allows_dual_entry
    from tournaments t
    join regions r on r.id = t.region_id
    where t.id = new.tournament_id;

  if v_participant_region_id <> v_tournament_region_id then
    raise exception 'participant belongs to another region'
      using errcode = 'P0008';
  end if;

  if v_allows_dual_entry then
    return new;
  end if;

  -- A statement of its own after the lock, so it sees what a concurrent
  -- submission committed while this one waited. Every status but `cancelled`
  -- occupies the region, and this row's own tournament is excluded so
  -- re-entering it after cancelling still goes through.
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

-- Created before the old triggers go, so that no write gets through unchecked
-- whether or not this file is applied as one transaction.
create trigger entries_check_seat
  before insert or update on entries
  for each row
  execute function check_entry_seat();

drop trigger entries_check_region_dual_entry on entries;
drop trigger entries_check_participant_region on entries;
drop function check_region_dual_entry();
drop function check_participant_region();

-- キャンセルした大会へのエントリーで、キャンセル済みの行を再利用する
-- (`enterTournament()`)。参加者行を `for no key update` で取ってから UPDATE
-- する。`check_entry_seat()` はこのトランザクションが持っているロックを取り
-- 直すだけなので待たず、地域と重複エントリーの検査はトリガのまま
-- (`P0008` / `P0005` はそのまま呼び出し側へ返る)。
--
-- 再エントリーは新しく入れた行と同じ状態から始める。確定待ちで、未確認で、
-- キャンセル待ちの順位も、以前のキャンセルの記録も持たない。
--
-- 行が `cancelled` でなくなっていれば何も更新せず、0 行を返す。同時の再エントリー
-- が先に取った場合と、`take_over_unverified_participant()` が行を消した場合で、
-- どちらも参加者行のロックを待っていた間に起きる。UPDATE は別の文なので、それを
-- 見てから判断する。
--
-- `setof entries` を返すのは、呼び出し側が INSERT と同じ `.select('id').single()`
-- で受けられるようにするため。0 行は PostgREST の `PGRST116` になる。
create function reenter_cancelled_entry(
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
          cancelled_at = null
      where e.id = p_entry_id
        and e.participant_id = p_participant_id
        and e.status = 'cancelled'
      returning e.*;
end;
$$;

revoke all on function reenter_cancelled_entry(
  uuid, uuid, text, text, text, text, jsonb
) from public;
grant execute on function reenter_cancelled_entry(
  uuid, uuid, text, text, text, text, jsonb
) to service_role;
